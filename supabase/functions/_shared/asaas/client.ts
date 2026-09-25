// WP-ASAAS-03 — cliente HTTP outbound para a API Asaas (Sandbox nesta WP).
// Header de auth é `access_token` (NUNCA `Authorization: Bearer`). User-Agent identificável.
//
// ASAAS-03C — redação de erro: a estratégia é NUNCA reter o corpo bruto de uma resposta além
// do instante da classificação. asaasFetch nunca devolve rawText/networkError cru — só um
// `category` (string curta, fixa) e um `outcome` de 3 valores. Não há nada para redigir
// depois porque nada sensível (cpfCnpj/email/nome/access_token/payload financeiro) chega a
// sair desta função. Isso substitui a estratégia anterior (redactSensitiveValues, nunca
// usada em lugar nenhum — dead code removido).

export type AsaasEnvironment = "sandbox" | "production";

const BASE_URL: Record<AsaasEnvironment, string> = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
};

/** Base URL canônica do ambiente. Sem default para production. */
export function asaasBaseUrl(environment: AsaasEnvironment): string {
  return BASE_URL[environment];
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Lê e valida ASAAS_OUTBOUND_ENVIRONMENT. Fail-closed: ausente/inválido -> null. */
export function resolveOutboundEnvironment(raw: string | undefined): AsaasEnvironment | null {
  if (raw === "sandbox" || raw === "production") return raw;
  return null;
}

export interface AsaasCredentials {
  apiKey: string;
  baseUrl: string;
}

/** Lê a API Key do ambiente resolvido. Lança se faltar (fail-closed, mesma forma do webhook). */
export function readAsaasCredentials(environment: AsaasEnvironment): AsaasCredentials {
  const secretName = environment === "production" ? "ASAAS_API_KEY_PRODUCTION" : "ASAAS_API_KEY_SANDBOX";
  const apiKey = Deno.env.get(secretName) ?? "";
  if (!apiKey) {
    throw new Error("asaas_not_configured");
  }
  return { apiKey, baseUrl: BASE_URL[environment] };
}

/**
 * "success": 2xx com corpo JSON parseável (o shape ainda precisa ser validado pelo caller —
 *   ver hasStringId). "deterministic_rejection": a Asaas recusou ANTES de criar o recurso
 *   (4xx de validação, 429 de rate limit) — comprovadamente seguro repetir com um POST novo.
 * "unknown": qualquer cenário em que não é possível provar que o recurso NÃO foi criado
 *   (timeout, conexão interrompida, 5xx, 2xx com corpo vazio/malformado). Nunca autoriza
 *   um novo POST — só lookup-first (ver isOutcomeUnknownCategory e ensureCustomer/
 *   ensureSubscription).
 */
export type AsaasOutcome = "success" | "deterministic_rejection" | "unknown";

export interface AsaasResult<T> {
  outcome: AsaasOutcome;
  status: number;
  data: T | null;
  /** Categoria curta e fixa — nunca contém texto bruto da resposta. */
  category: string;
  /** Erros 4xx estritamente limitados e sanitizados. Nunca contém o corpo bruto. */
  providerErrors?: SafeAsaasProviderError[];
}

export interface SafeAsaasProviderError {
  code: string;
  description: string;
}

const MAX_PROVIDER_ERROR_BODY_CHARS = 16_384;
const MAX_PROVIDER_ERRORS = 3;
const MAX_PROVIDER_ERROR_CODE_CHARS = 80;
const MAX_PROVIDER_ERROR_DESCRIPTION_CHARS = 240;

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
}

function sanitizeProviderErrorCode(value: unknown): string {
  if (typeof value !== "string") return "unknown_provider_error";
  const safe = value.trim().replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, MAX_PROVIDER_ERROR_CODE_CHARS);
  return safe || "unknown_provider_error";
}

function sanitizeProviderErrorDescription(value: unknown): string {
  if (typeof value !== "string") return "Provider rejected the request";
  const safe = replaceControlCharacters(value.slice(0, 2_048))
    .replace(
      /\b(nome|name|legalName|address|endereco|endereço|logradouro|complemento?)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^,;]+)/gi,
      "$1=[REDACTED_PII]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[REDACTED_ID]")
    .replace(/\b(?:cus|pay|sub|checkout|evt|tok|key)_[a-zA-Z0-9_-]+\b/gi, "[REDACTED_ID]")
    .replace(/(?:\+?\d{1,3}\s*)?\(?\d{2,3}\)?[\s.-]*\d{4,5}[\s.-]*\d{4}\b/g, "[REDACTED_NUMBER]")
    .replace(/\b(?:\d[.\s-]?){9,18}\d\b/g, "[REDACTED_NUMBER]")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[REDACTED_URL]")
    .replace(/\b[a-zA-Z0-9_=-]{24,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\s+/g, " ")
    .trim();
  return (safe || "Provider rejected the request").slice(0, MAX_PROVIDER_ERROR_DESCRIPTION_CHARS);
}

/**
 * Extrai somente o envelope documentado `errors[].code/description` de um 4xx.
 * Corpos grandes, JSON fora desse shape e qualquer outro campo são descartados.
 */
export function parseSafeAsaasProviderErrors(rawBody: string): SafeAsaasProviderError[] {
  if (!rawBody || rawBody.length > MAX_PROVIDER_ERROR_BODY_CHARS) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const errors = (parsed as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, MAX_PROVIDER_ERRORS).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as { code?: unknown; description?: unknown };
    if (typeof item.code !== "string" && typeof item.description !== "string") return [];
    return [{
      code: sanitizeProviderErrorCode(item.code),
      description: sanitizeProviderErrorDescription(item.description),
    }];
  });
}

const DETERMINISTIC_REJECTION_CATEGORIES = new Set(["http_4xx", "rate_limited"]);

/**
 * true quando `category` (nova, ou lida de volta de last_error_category no ledger) significa
 * "não temos prova de que a Asaas NÃO criou o recurso" — nunca seguro para um novo POST às
 * cegas. Ausência de categoria (null/undefined — nenhuma tentativa anterior resolvida ainda,
 * ex.: um attempt concorrente genuinamente em voo) é tratada como unknown por padrão
 * conservador: uma duplicação financeira é pior que exigir nova reconciliação.
 */
export function isOutcomeUnknownCategory(category: string | null | undefined): boolean {
  if (!category) return true;
  return !DETERMINISTIC_REJECTION_CATEGORIES.has(category);
}

/** Guarda de shape mínima: todo recurso Asaas que persistimos precisa de um `id` não vazio. */
export function hasStringId(data: unknown): data is { id: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as { id?: unknown }).id === "string" &&
    (data as { id: string }).id.length > 0
  );
}

/**
 * Fetch outbound para a Asaas. Nunca lança. Nunca retorna outcome:"success" sem ter
 * conseguido ler E parsear um corpo JSON — um 2xx vazio/malformado é sempre "unknown", nunca
 * confundido com sucesso nem com rejeição comprovada.
 */
export async function asaasFetch<T>(
  creds: AsaasCredentials,
  environment: AsaasEnvironment,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<AsaasResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${creds.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        access_token: creds.apiKey,
        "User-Agent": `Vertexa/asaas-03c (Deno; ${environment})`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (_e) {
    // AbortError (timeout) ou falha de rede antes de qualquer resposta: nunca sabemos se a
    // Asaas processou a request. outcome:"unknown" — NUNCA "deterministic_rejection".
    clearTimeout(timer);
    return { outcome: "unknown", status: 0, data: null, category: "network_timeout" };
  }
  clearTimeout(timer);

  let text: string;
  try {
    text = await res.text();
  } catch (_e) {
    // Conexão interrompida no meio da leitura do corpo: mesmo raciocínio do catch acima —
    // o request pode ter sido aceito e processado antes da conexão cair.
    return { outcome: "unknown", status: res.status, data: null, category: "network_timeout" };
  }

  if (res.status >= 500) {
    // A request pode ter sido aceita e processada antes de um 5xx (ex.: erro ao montar a
    // resposta, timeout interno do provider depois de já ter criado o recurso).
    return { outcome: "unknown", status: res.status, data: null, category: "provider_5xx" };
  }
  if (res.status === 429) {
    // Recusado no rate limit, antes de qualquer processamento de criação.
    return { outcome: "deterministic_rejection", status: res.status, data: null, category: "rate_limited" };
  }
  if (res.status >= 400) {
    // Validação determinística: a Asaas recusou antes de criar o recurso.
    const providerErrors = parseSafeAsaasProviderErrors(text);
    return {
      outcome: "deterministic_rejection",
      status: res.status,
      data: null,
      category: "http_4xx",
      ...(providerErrors.length > 0 ? { providerErrors } : {}),
    };
  }

  // 2xx a partir daqui — mas um 2xx sem corpo utilizável NUNCA prova "nada foi criado".
  if (!text) {
    return { outcome: "unknown", status: res.status, data: null, category: "empty_2xx_body" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { outcome: "unknown", status: res.status, data: null, category: "malformed_2xx_body" };
  }

  return { outcome: "success", status: res.status, data: parsed as T, category: "ok" };
}
