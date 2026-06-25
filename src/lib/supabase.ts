import { createClient } from "@supabase/supabase-js";

// Cliente único — APENAS anon key (dados de saúde: nunca expor chave de serviço no client).
// A autorização real é responsabilidade do backend (RLS) — pendência pós-22/06.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * true quando as variáveis de ambiente do Supabase existem. O boot (main.tsx) usa esta
 * flag para exibir uma tela de configuração amigável em vez de estourar um throw no
 * carregamento do módulo — que deixava a aplicação em tela branca (React nem montava),
 * o crash visto na Review em clones sem `.env` (`.env` é gitignored; só `.env.example` é versionado).
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured && import.meta.env.DEV) {
  // Não logar valores; apenas sinalizar a ausência para depuração local.
  console.error(
    "[VERTEXA] VITE_SUPABASE_URL e/ou VITE_SUPABASE_ANON_KEY ausentes. " +
      "Copie .env.example para .env e preencha os valores do Supabase.",
  );
}

// Fallback inócuo quando ausentes: evita que createClient() lance no carregamento do módulo.
// Sob ausência de config, o boot NÃO monta os providers nem dispara chamadas (ver main.tsx);
// a tela de configuração é exibida antes de qualquer uso real deste client.
export const supabase = createClient(
  supabaseUrl || "http://localhost:54321",
  supabaseAnonKey || "anon-key-missing",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);
