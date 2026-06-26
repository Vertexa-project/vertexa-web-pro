// Cliente Supabase com service_role para as Edge Functions (S10).
// service_role IGNORA RLS — é o ÚNICO caminho que lê/escreve calendar_connection_tokens (deny-all).
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados pelo runtime das Edge Functions.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export function supabaseAdmin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
