import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { Providers } from "@/providers";
import { router } from "@/app/router";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { EnvConfigError } from "@/app/EnvConfigError";
import { assertAuthMode } from "@/lib/auth/authMode";
import { isSupabaseConfigured } from "@/lib/supabase";
import { initObservability } from "@/lib/observability/sentry";
import "@/index.css";

// Observabilidade primeiro: liga o Sentry ANTES do render para capturar erros de boot.
// Sem VITE_SENTRY_DSN é um no-op absoluto — o app roda idêntico com e sem observabilidade.
initObservability();
// Fail-closed: VITE_AUTH_MODE=demo (ou qualquer valor que não seja real/vazio) não sobe o painel.
assertAuthMode();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isSupabaseConfigured ? (
        <Providers>
          <RouterProvider router={router} future={{ v7_startTransition: true }} />
        </Providers>
      ) : (
        <EnvConfigError />
      )}
    </ErrorBoundary>
  </React.StrictMode>,
);
