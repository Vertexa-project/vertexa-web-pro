/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // Profissional atuante em modo demo (sem auth real). Ver src/lib/session.ts.
  readonly VITE_DEMO_PROFESSIONAL_PROFILE_ID?: string;
  // Observabilidade (Sentry). Todas OPCIONAIS — sem DSN a observabilidade fica desligada.
  // Ver src/lib/observability/sentry.ts e docs/ops/OBSERVABILITY.md.
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_APP_ENV?: string;
  readonly VITE_APP_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
