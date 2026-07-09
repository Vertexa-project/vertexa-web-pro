// Pin de identidade do MODO DEMO (VITE_AUTH_MODE=demo). No seed é a Dra. Camila Rocha (...a2).
//
// ⚠️ Ramo DEMO da identidade: consumido SOMENTE por `useIdentity` quando AUTH_MODE="demo".
// No modo real a identidade vem de `auth.uid()` → profiles.auth_user_id (ver src/hooks/
// useIdentity.ts + docs/CONTRATO_INTEGRACAO.md). Nunca confiar nisto como autorização (RLS = WP-05).
export const DEMO_PROFESSIONAL_PROFILE_ID: string | null =
  import.meta.env.VITE_DEMO_PROFESSIONAL_PROFILE_ID || null;
