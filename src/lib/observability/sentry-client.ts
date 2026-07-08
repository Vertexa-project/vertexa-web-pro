import { captureException as sentryCapture, init, withScope } from "@sentry/react";

import { scrubBreadcrumb, scrubEvent } from "./scrub";
import type { CaptureContext, ObservabilityConfig } from "./sentry";

/**
 * Camada PESADA da observabilidade — a única que importa `@sentry/react`. É carregada por
 * `import()` dinâmico a partir de `sentry.ts` SOMENTE quando há DSN, então:
 * - vira um chunk assíncrono próprio (fora do caminho crítico do boot);
 * - usa imports NOMEADOS (`init`/`withScope`/`captureException`) → tree-shaking preserva
 *   só o necessário do SDK (sem DSN, este chunk nem é baixado).
 *
 * O scrubbing (LGPD/saúde) vive em `scrub.ts` (puro/testável) e é ligado aqui em
 * `beforeSend`/`beforeBreadcrumb`.
 */

/** Inicializa o SDK. Chamada uma única vez, após o chunk carregar. */
export function startSentry(config: ObservabilityConfig): void {
  init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    // LGPD/saúde: nunca anexar IP/cookies/headers automaticamente.
    sendDefaultPii: false,
    tracesSampleRate: config.tracesSampleRate,
    // Rede de segurança final: TODO evento e TODO breadcrumb passam pelo scrubbing puro
    // antes de sair do browser. (unhandledrejection/onerror já são capturados pela
    // integração default `globalHandlers` do SDK.)
    beforeSend(event) {
      return scrubEvent(
        event as unknown as Record<string, unknown>,
      ) as unknown as typeof event;
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(
        breadcrumb as unknown as Record<string, unknown>,
      ) as unknown as typeof breadcrumb;
    },
  });
}

/** Reporta um erro com metadados NÃO-sensíveis. O evento passa por `beforeSend` (scrubbing). */
export function reportException(error: unknown, context: CaptureContext): void {
  withScope((scope) => {
    if (context.source) scope.setTag("source", context.source);
    if (context.scope) scope.setTag("scope", context.scope);
    if (context.componentStack) {
      scope.setContext("react", { componentStack: context.componentStack });
    }
    sentryCapture(error);
  });
}
