// Modo de autenticação da web. Default = "demo" para NÃO mudar nada hoje (expansão).
//
// - demo: identidade vem do pin de env (VITE_DEMO_PROFESSIONAL_PROFILE_ID). App IDÊNTICO ao
//   de hoje (login demo, seletor de papel de demonstração, mesmos dados).
// - real: identidade vem da sessão Supabase (auth.uid() → profiles.auth_user_id → profile →
//   professional → clinic). Login Google real; pending → PendingAccess.
//
// ⚠️ RLS ainda é permissiva (sprint) nos dois modos — fechar por papel/clínica é o WP-05.
export type AuthMode = "demo" | "real";

export const AUTH_MODE: AuthMode =
  import.meta.env.VITE_AUTH_MODE === "real" ? "real" : "demo";

export const isRealAuth = AUTH_MODE === "real";
export const isDemoAuth = AUTH_MODE === "demo";
