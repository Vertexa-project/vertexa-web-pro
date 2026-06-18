// Identidade do profissional atuante na web.
//
// Em modo demo (sem auth real) é FIXA via env — no seed é a Dra. Camila Rocha
// (...a2). É o remetente das mensagens enviadas pela web e o alvo das menções
// (badge "mencionado"). Sob auth real isto virá de `auth.uid()` → profiles
// (ver docs/PENDENCIAS.md #14); não confiar nisto como autorização.
export const DEMO_PROFESSIONAL_PROFILE_ID: string | null =
  import.meta.env.VITE_DEMO_PROFESSIONAL_PROFILE_ID || null;
