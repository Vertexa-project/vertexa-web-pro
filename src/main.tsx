import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { Providers } from "@/providers";
import { router } from "@/app/router";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { EnvConfigError } from "@/app/EnvConfigError";
import { isSupabaseConfigured } from "@/lib/supabase";
import "@/index.css";

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
