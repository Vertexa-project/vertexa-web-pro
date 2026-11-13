// Consulta assistida — autenticação do chamador das Edge Functions clinical-*.
// O JWT do usuário é validado no gateway (verify_jwt=true) E aqui; a autorização é a do BANCO
// (public.clinical_check_encounter_access = helper de equipe clínica com acesso ao paciente).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse } from "../cors.ts";
import { supabaseUser } from "../supabaseUser.ts";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireUser(req: Request): Promise<{ user: SupabaseClient } | Response> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
  if (!token) return jsonResponse({ error: "unauthenticated" }, 401);
  const user = supabaseUser(req);
  const { data, error } = await user.auth.getUser(token);
  if (error || !data.user?.id) return jsonResponse({ error: "unauthenticated" }, 401);
  return { user };
}

export async function canAccessEncounter(user: SupabaseClient, encounterId: string): Promise<boolean> {
  const { data, error } = await user.rpc("clinical_check_encounter_access", { p_encounter: encounterId });
  return !error && data === true;
}

export function aiKey(): string | null {
  const k = Deno.env.get("OPENAI_API_KEY");
  return k && k.trim() ? k.trim() : null;
}
