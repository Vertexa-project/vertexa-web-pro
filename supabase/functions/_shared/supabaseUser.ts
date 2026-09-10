// WP-ASAAS-03 — cliente Supabase de CONTEXTO DO USUÁRIO (repassa o JWT do caller).
// Usado só para RPCs Padrão B (auth.uid()-gated), nunca para as service_role-only.
// Diferente de supabaseAdmin.ts: este client NÃO ignora RLS, resolve auth.uid() como o
// PostgREST faria se tivesse recebido a chamada direto.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export function supabaseUser(req: Request): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
}
