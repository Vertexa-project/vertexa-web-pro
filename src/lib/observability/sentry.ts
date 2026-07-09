/**
 * Fundação de observabilidade (Sentry, browser) — FACADE LEVE.
 *
 * Este módulo é o ponto de entrada estático (importado por `main.tsx`, `ErrorBoundary` e
 * `query-client`). Ele NÃO importa `@sentry/react` — a camada pesada vive em
 * `sentry-client.ts` e é carregada por `import()` dinâmico só quando há DSN. Consequências:
 * - **Sem DSN = no-op absoluto:** o SDK nem é baixado; o boot roda IDÊNTICO e nunca quebra.
 * - **Init tardio / boot leve:** o chunk do Sentry é assíncrono, fora do caminho crítico.
 * - **Dado de saúde nunca sai:** scrubbing agressivo em `scrub.ts`, ligado no `sentry-client`.
 * - **Tracing de performance DESLIGADO** nesta fundação (`tracesSampleRate: 0`) para não
 *   vazar URL assinada em spans. Ver `docs/ops/OBSERVABILITY.md`.
 */

export interface ObservabilityConfig {
  /** Só liga quando há DSN. */
  readonly enabled: boolean;
  readonly dsn: string;
  readonly environment: string;
  readonly release: string | undefined;
  readonly tracesSampleRate: number;
}

/** Subconjunto de `import.meta.env` que a resolução de config consome (puro/testável). */
export interface ObservabilityEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_APP_ENV?: string;
  readonly VITE_APP_RELEASE?: string;
  readonly MODE?: string;
  readonly PROD?: boolean;
}

/** Metadados NÃO-sensíveis anexáveis a uma captura manual. */
export interface CaptureContext {
  /** Origem lógica (ex.: "error-boundary", "react-query"). */
  readonly source?: string;
  /** Escopo lógico (ex.: "query", "mutation"). NUNCA passar dado de paciente aqui. */
  readonly scope?: string;
  /** Component stack do React (nomes de componente; sem PII). */
  readonly componentStack?: string;
}

/**
 * Deriva a config a partir do ambiente. PURA (não toca `import.meta` nem o SDK) para ser
 * exercitável em Node com um env sintético. Sem DSN → `enabled:false`.
 */
export function resolveSentryConfig(env: ObservabilityEnv): ObservabilityConfig {
  const dsn = (env.VITE_SENTRY_DSN ?? "").trim();
  const environment = (env.VITE_APP_ENV ?? env.MODE ?? "development").trim();
  const release = (env.VITE_APP_RELEASE ?? "").trim() || undefined;

  return {
    enabled: dsn.length > 0,
    dsn,
    environment,
    release,
    // Tracing desligado na fundação (ver nota do módulo). Mantido baixo por segurança.
    tracesSampleRate: 0,
  };
}

/** Referência a `reportException` do client, populada após o load; `null` = SDK não pronto. */
let report: ((error: unknown, context: CaptureContext) => void) | null = null;
/** Evita disparar o load/init mais de uma vez. */
let initStarted = false;

/** true quando o SDK já foi carregado e inicializado (transporte ativo). */
export function isObservabilityEnabled(): boolean {
  return report !== null;
}

/**
 * Inicializa o Sentry se — e somente se — houver DSN. Idempotente. Dispara o `import()`
 * dinâmico da camada pesada e a inicializa quando o chunk chega. Retorna `true` quando a
 * inicialização foi DISPARADA (há DSN); `false` no no-op sem DSN. Chamada cedo em
 * `main.tsx`, antes do render, para instalar os handlers globais o quanto antes.
 */
export function initObservability(): boolean {
  if (initStarted) return report !== null;

  const config = resolveSentryConfig(import.meta.env);
  if (!config.enabled) {
    // Sem DSN: no-op deliberado. O SDK nem é baixado; zero impacto no boot.
    return false;
  }

  initStarted = true;
  void import("./sentry-client")
    .then((mod) => {
      mod.startSentry(config);
      report = mod.reportException;
    })
    .catch(() => {
      // Falha ao carregar o chunk do SDK NUNCA pode quebrar o app — segue como no-op.
    });

  return true;
}

/**
 * Reporta um erro ao Sentry quando ligado; no-op silencioso quando não há DSN ou o SDK
 * ainda não terminou de carregar. O evento passa por `beforeSend` (scrubbing) antes do
 * envio. Só anexe metadados comprovadamente não-sensíveis.
 */
export function captureException(error: unknown, context: CaptureContext = {}): void {
  report?.(error, context);
}
