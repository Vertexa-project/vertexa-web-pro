// Edge Function: google-calendar-auth (INIT do OAuth) — S10.
// Chamada pelo SPA (admin) via supabase.functions.invoke. Gera state anti-CSRF (TTL 10min, single-use),
// guarda (state, clinic_id, professional_id, redirect_to) e devolve a URL de consentimento do Google.
// Pré-S9: NÃO há auth.uid(); a identidade (clinicId/professionalId) vem do client (dívida #11–#14).
// O gating de admin é de UI; a barreira real de tokens é a tabela deny-all + service_role.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  buildConsentUrl,
  GOOGLE_SCOPES,
  randomState,
  readGoogleCredentials,
  safeRedirectBase,
} from "../_shared/google.ts";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: { clinicId?: string; professionalId?: string; redirectTo?: string };
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse({ error: "invalid_body" }, 400);
  }

  const clinicId = (body.clinicId ?? "").trim();
  const professionalId = (body.professionalId ?? "").trim() || null;
  const redirectBase = safeRedirectBase(body.redirectTo);
  if (!clinicId) return jsonResponse({ error: "missing_clinic" }, 400);

  let creds;
  try {
    creds = readGoogleCredentials();
  } catch (_e) {
    // Segredos do Google ainda não configurados (ex.: modo demo). Erro amigável p/ a UI.
    return jsonResponse({ error: "google_not_configured" }, 503);
  }

  const db = supabaseAdmin();

  // Integridade (não é segurança): o profissional informado pertence à clínica informada?
  if (professionalId) {
    const { data: prof } = await db
      .from("professionals")
      .select("id, clinic_id")
      .eq("id", professionalId)
      .maybeSingle();
    if (prof && prof.clinic_id !== clinicId) {
      return jsonResponse({ error: "professional_clinic_mismatch" }, 400);
    }
  }

  const state = randomState();
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
  const { error: stErr } = await db.from("calendar_oauth_state").insert({
    state,
    clinic_id: clinicId,
    professional_id: professionalId,
    redirect_to: redirectBase,
    expires_at: expiresAt,
  });
  if (stErr) return jsonResponse({ error: "state_persist_failed" }, 500);

  return jsonResponse({ url: buildConsentUrl(creds, state), scopes: GOOGLE_SCOPES.join(" ") });
});
