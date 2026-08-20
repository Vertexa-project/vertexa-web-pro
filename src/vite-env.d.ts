/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // Legado. Ausente / vazio / "real" = ok. Qualquer outro valor (incl. "demo") falha no boot.
  // Ver src/lib/auth/authMode.ts. Não remove da Vercel neste WP — lá já está "real" (inócua).
  readonly VITE_AUTH_MODE?: string;
  // Observabilidade (Sentry). Todas OPCIONAIS — sem DSN a observabilidade fica desligada.
  // Ver src/lib/observability/sentry.ts e docs/ops/OBSERVABILITY.md.
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_APP_ENV?: string;
  readonly VITE_APP_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
