// WP-ASAAS-03 — cliente HTTP outbound para a API Asaas (Sandbox nesta WP).
// Header de auth é `access_token` (NUNCA `Authorization: Bearer`). User-Agent identificável.
// Nunca loga API Key, cpfCnpj, email ou payload financeiro bruto — ver redactAsaasError.

export type AsaasEnvironment = "sandbox" | "production";

const BASE_URL: Record<AsaasEnvironment, string> = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
};

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

export interface AsaasResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** Texto bruto sanitizado (só quando !ok e o corpo não era JSON válido). */
  rawText: string | null;
  /** true quando a request nem chegou a ter resposta (timeout/erro de rede). */
  networkError: boolean;
}

/**
 * Remove qualquer ocorrência literal dos valores sensíveis passados (cpfCnpj, email, name, ...)
 * de um texto antes de log/retorno. A Asaas pode ecoar esses campos em mensagens de validação.
 */
export function redactSensitiveValues(text: string, sensitiveValues: Array<string | undefined>): string {
  let out = text;
  for (const value of sensitiveValues) {
    if (typeof value === "string" && value.length >= 3) {
      out = out.split(value).join("[REDACTED]");
    }
  }
  return out;
}

/** Fetch outbound para a Asaas. Nunca lança por causa de status HTTP — só por erro de rede/timeout. */
export async function asaasFetch<T>(
  creds: AsaasCredentials,
  environment: AsaasEnvironment,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<AsaasResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${creds.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        access_token: creds.apiKey,
        "User-Agent": `Vertexa/asaas-03a (Deno; ${environment})`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data: T | null = null;
    try {
      data = text ? (JSON.parse(text) as T) : null;
    } catch {
      return { ok: false, status: res.status, data: null, rawText: text, networkError: false };
    }
    return { ok: res.ok, status: res.status, data, rawText: res.ok ? null : text, networkError: false };
  } catch (_e) {
    // AbortError (timeout) ou falha de rede: nunca sabemos se a Asaas processou ou não.
    return { ok: false, status: 0, data: null, rawText: null, networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Classifica uma resposta não-2xx / erro de rede em last_error_category (seção K do plano). */
export function classifyAsaasFailure(result: AsaasResult<unknown>): string {
  if (result.networkError) return "network_timeout";
  if (result.status === 429) return "rate_limited";
  if (result.status >= 500) return "provider_5xx";
  if (result.status >= 400) return "http_4xx";
  if (result.data === null && result.rawText !== null) return "invalid_response";
  return "unknown_error";
}
