import { createClient } from "@supabase/supabase-js";

// Cliente único — APENAS anon key (dados de saúde: nunca expor chave de serviço no client).
// A autorização real é responsabilidade do backend (RLS) — pendência pós-22/06.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY ausentes. Confira o arquivo .env.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
