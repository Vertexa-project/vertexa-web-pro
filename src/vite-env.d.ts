/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // Profissional atuante em modo demo (sem auth real). Ver src/lib/session.ts.
  readonly VITE_DEMO_PROFESSIONAL_PROFILE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
