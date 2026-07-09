/**
 * Scrubbing agressivo de dados sensíveis (SAÚDE / PII) para eventos de observabilidade.
 *
 * Este módulo é PURO e SEM dependência de framework (não importa `@sentry/*` nem
 * `import.meta.env`) de propósito: é o núcleo testável do contrato de privacidade.
 * `sentry.ts` o liga em `beforeSend`/`beforeBreadcrumb`; um evento sintético com PII
 * falsa pode ser passado por `scrubEvent` em Node para PROVAR que nada sensível sai.
 *
 * Regra (LGPD, dado de saúde): NENHUM nome, e-mail, telefone, CPF, diagnóstico,
 * mensagem de chat, plano, exame, URL assinada de storage, id de paciente (UUID em
 * rota) ou token pode chegar ao provedor. Na dúvida, REDIGE. É melhor perder contexto
 * do que vazar dado clínico.
 */

export const REDACTED = "[redacted]";

/** Profundidade/tamanho máximos ao percorrer estruturas (guarda anti-runaway). */
const MAX_DEPTH = 8;
const MAX_NODES = 5000;

/**
 * Nomes de chave considerados sensíveis (case-insensitive, por substring). Se a CHAVE
 * casar, o VALOR inteiro é redigido — não importa o formato. Deliberadamente amplo.
 */
const SENSITIVE_KEY_RE =
  /(name|nome|email|e-mail|mail|phone|telefone|celular|whatsapp|cpf|cnpj|\brg\b|birth|nascimento|diagnos|diagnóst|laudo|exam|exame|prescri|plano|\bplan\b|meal|refei|supplement|suplement|message|mensagem|\bbody\b|notes?|nota|observ|address|endere|patient|paciente|token|secret|senha|password|passwd|authorization|api[-_]?key|signature|signed|cookie|session|jwt|bearer)/i;

/**
 * Nomes de chave cujo valor é uma URL/rota — passam por `redactUrl` (mantém origem+rota,
 * remove query/assinatura e mascara UUID de paciente na rota).
 */
const URL_KEY_RE = /(url|href|uri|referr?er|location|route|path|pathname|\bto\b|\bfrom\b)/i;

/**
 * Contextos populados pelo SDK que NÃO contêm PII (nome de browser/os etc.). São
 * preservados; qualquer outro contexto (ex.: "patient") passa por `redactDeep`.
 * Fora daqui de propósito: `device` (device.name pode ser "iPhone do João") e `app`.
 */
const SAFE_CONTEXT_KEYS = new Set(["browser", "os", "runtime", "trace", "culture", "gpu"]);

/**
 * Palavras-chave clínicas que, num texto LIVRE (mensagem de erro / value de exceção),
 * costumam preceder dado sensível ("paciente Maria", "diagnóstico: X", "plano: Y").
 * Redige o keyword + tudo que vem depois até um delimitador. Só aplicado a `message` e
 * ao `value` da exceção (via `redactFreeText`) — não a strings estruturadas.
 */
const CLINICAL_PHRASE_RE =
  /\b(pacientes?|patients?|nome|name|diagn[oó]?st\w*|diagnosis|prontu\w*|plano|plan|exames?|exam|laudo|prescri\w*|medica\w*|receita|alerg\w*)\b[\s:=–-]*[^;)(\]\n]+/gi;

/** E-mail embutido em texto livre. */
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Telefone BR (com/sem DDI/DDD, com/sem separadores) — conservador (≥8 dígitos). */
const PHONE_RE = /(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?\d{4,5}[\s.-]?\d{4}\b/g;

/** JWT (3 segmentos base64url separados por ponto). */
const JWT_RE = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

/** Hash/token longo em hex ou base64url (≥32) — chaves de assinatura, ids opacos. */
const LONG_TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;

/** UUID v4-like — id de paciente/registro. Mascarado em ROTAS (não em texto qualquer). */
const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Redige PII ESTRUTURADA embutida numa string (UUID/email/JWT/telefone/token). UUID
 * primeiro, para não ser fragmentado pelas outras regras (ex.: a de telefone).
 */
export function redactString(input: string): string {
  if (!input) return input;
  return input
    .replace(UUID_RE, REDACTED)
    .replace(EMAIL_RE, REDACTED)
    .replace(JWT_RE, REDACTED)
    .replace(PHONE_RE, REDACTED)
    .replace(LONG_TOKEN_RE, REDACTED);
}

/**
 * Redige TEXTO LIVRE de alto risco (mensagem de erro, `value` de exceção): PII estruturada
 * + frases clínicas ("paciente Nome", "diagnóstico: …", "plano: …"). Deliberadamente
 * agressivo — em dúvida, perde contexto de debug para não vazar dado clínico. Nomes/textos
 * sem palavra-chave clínica NÃO são detectáveis por padrão (ver residual em OBSERVABILITY.md).
 */
export function redactFreeText(input: string): string {
  if (!input) return input;
  return redactString(input).replace(CLINICAL_PHRASE_RE, (_match, keyword: string) => {
    return `${keyword}: ${REDACTED}`;
  });
}

/**
 * Reduz uma URL a `origem + caminho`, DESCARTANDO query e hash (onde vivem tokens e
 * URLs assinadas de storage) e mascarando UUIDs no caminho (id de paciente em rota).
 * Aceita URL absoluta ou caminho relativo.
 */
export function redactUrl(input: string): string {
  if (!input) return input;
  const maskPath = (path: string) => path.replace(UUID_RE, ":id");
  try {
    const u = new URL(input);
    // Credenciais embutidas (user:pass@host) nunca devem persistir.
    u.username = "";
    u.password = "";
    return `${u.origin}${maskPath(u.pathname)}`;
  } catch {
    // Caminho relativo ("/pacientes/<uuid>?x=1#y") — corta em ? ou #.
    const path = input.split(/[?#]/, 1)[0];
    return maskPath(path);
  }
}

/**
 * Percorre recursivamente um valor JSON-like:
 * - chave sensível  → valor redigido por completo;
 * - chave de URL    → `redactUrl`;
 * - string          → `redactString`;
 * - objeto/array    → recursão (com guardas de profundidade/tamanho/ciclo).
 */
export function redactDeep(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let nodes = 0;

  const walk = (val: unknown, depth: number): unknown => {
    if (val == null) return val;
    if (nodes++ > MAX_NODES || depth > MAX_DEPTH) return REDACTED;

    if (typeof val === "string") return redactString(val);
    if (typeof val === "number" || typeof val === "boolean") return val;

    if (Array.isArray(val)) {
      if (seen.has(val)) return REDACTED;
      seen.add(val);
      return val.map((item) => walk(item, depth + 1));
    }

    if (isPlainObject(val)) {
      if (seen.has(val)) return REDACTED;
      seen.add(val);
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(val)) {
        if (SENSITIVE_KEY_RE.test(key)) {
          out[key] = REDACTED;
        } else if (URL_KEY_RE.test(key) && typeof child === "string") {
          out[key] = redactUrl(child);
        } else {
          out[key] = walk(child, depth + 1);
        }
      }
      return out;
    }

    // Tipos não serializáveis (function/symbol/bigint) não deveriam existir num evento.
    return REDACTED;
  };

  return walk(value, 0);
}

/**
 * Redige um breadcrumb (rastro que o SDK anexa a cada evento: fetch/xhr/console/
 * navegação…). URLs de fetch carregam a URL assinada do storage; console/argumentos
 * podem carregar payloads clínicos; navegação carrega a rota com id de paciente.
 * Retorna o breadcrumb saneado (nunca `null` — o SDK decide manter ou não).
 */
export function scrubBreadcrumb(breadcrumb: Record<string, unknown>): Record<string, unknown> {
  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = redactString(breadcrumb.message);
  }
  if (isPlainObject(breadcrumb.data)) {
    breadcrumb.data = redactDeep(breadcrumb.data) as Record<string, unknown>;
  }
  return breadcrumb;
}

/**
 * Redige um evento inteiro do Sentry ANTES do envio. Muta e retorna o próprio evento.
 * Cobre: user (removido), request (url mascarada; headers/cookies/data/query fora),
 * mensagem, valores/vars de exceção, breadcrumbs, extra/tags/contexts e server_name.
 */
export function scrubEvent(event: Record<string, unknown>): Record<string, unknown> {
  // 1) Identidade do usuário: fora por completo (id/email/ip/username).
  delete event.user;
  delete event.server_name;

  // 2) Request: manter só a rota mascarada; o resto pode conter Authorization/Cookie/PII.
  if (isPlainObject(event.request)) {
    const req = event.request;
    if (typeof req.url === "string") req.url = redactUrl(req.url);
    delete req.cookies;
    delete req.headers;
    delete req.data;
    delete req.query_string;
  }

  // 3) Mensagem de topo (texto livre → scrubbing agressivo).
  if (typeof event.message === "string") {
    event.message = redactFreeText(event.message);
  }

  // 4) Exceções: sanear o "value" (texto livre) e DESCARTAR variáveis locais dos frames
  //    (podem conter o objeto de erro do Supabase com nome/diagnóstico/payload).
  if (isPlainObject(event.exception) && Array.isArray(event.exception.values)) {
    for (const value of event.exception.values) {
      if (!isPlainObject(value)) continue;
      if (typeof value.value === "string") value.value = redactFreeText(value.value);
      if (isPlainObject(value.stacktrace) && Array.isArray(value.stacktrace.frames)) {
        for (const frame of value.stacktrace.frames) {
          if (isPlainObject(frame)) delete frame.vars;
        }
      }
    }
  }

  // 5) Breadcrumbs já anexados ao evento.
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((b) =>
      isPlainObject(b) ? scrubBreadcrumb(b) : b,
    );
  } else if (isPlainObject(event.breadcrumbs) && Array.isArray(event.breadcrumbs.values)) {
    event.breadcrumbs.values = event.breadcrumbs.values.map((b) =>
      isPlainObject(b) ? scrubBreadcrumb(b) : b,
    );
  }

  // 6) Sacolas de contexto arbitrário: extra/tags/contexts. `redactDeep` preserva
  //    metadados não-sensíveis (browser/os/trace) e redige só chaves/valores de risco.
  if (isPlainObject(event.extra)) {
    event.extra = redactDeep(event.extra) as Record<string, unknown>;
  }
  if (isPlainObject(event.tags)) {
    event.tags = redactDeep(event.tags) as Record<string, unknown>;
  }
  // Contexts: preserva os metadados NÃO-sensíveis do SDK (browser/os/…); redige o resto.
  if (isPlainObject(event.contexts)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.contexts)) {
      out[key] = SAFE_CONTEXT_KEYS.has(key) ? value : redactDeep(value);
    }
    event.contexts = out;
  }

  return event;
}
