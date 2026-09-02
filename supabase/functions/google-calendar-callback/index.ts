// Edge Function: google-calendar-callback — S10. (verify_jwt=FALSE: é o redirect do Google, sem JWT.)
// Valida o state (existe + não expirado + single-use), troca code→tokens, grava metadado em
// calendar_connections e tokens em calendar_connection_tokens (service_role; tabela deny-all),
// e redireciona o navegador de volta ao SPA (.../configuracoes?calendar=connected|error).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  exchangeCode,
  getPrimaryCalendar,
  GOOGLE_SCOPES,
  readGoogleCredentials,
} from "../_shared/google.ts";

function backToApp(base: string | null, status: "connected" | "error"): Response {
  if (base) {
    return Response.redirect(`${base}/configuracoes?calendar=${status}`, 302);
  }
  // Sem origem conhecida: página neutra (sem dado sensível).
  return new Response(
    `Google Calendar: ${status === "connected" ? "conectado" : "falha"}. Você pode fechar esta aba e voltar ao VERTEXA.`,
    { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const db = supabaseAdmin();

  // 1) Resolve o state (anti-CSRF). Sem state válido não há para onde redirecionar com confiança.
  if (!stateParam) return backToApp(null, "error");
  const { data: stateRow } = await db
    .from("calendar_oauth_state")
    .select("state, clinic_id, professional_id, redirect_to, expires_at")
    .eq("state", stateParam)
    .maybeSingle();

  // 2) Single-use: apaga o state assim que resolvido (mesmo em erro).
  if (stateRow) {
    await db.from("calendar_oauth_state").delete().eq("state", stateParam);
  }

  const redirectBase: string | null = stateRow?.redirect_to ?? null;
  if (!stateRow) return backToApp(null, "error");
  if (new Date(stateRow.expires_at).getTime() < Date.now()) return backToApp(redirectBase, "error");
  if (oauthError || !code) return backToApp(redirectBase, "error");

  const { data: clinicRow } = await db
    .from("clinics")
    .select("status")
    .eq("id", stateRow.clinic_id)
    .maybeSingle();
  if (clinicRow?.status !== "active") return backToApp(redirectBase, "error");

  try {
    const creds = readGoogleCredentials();
    const tokens = await exchangeCode(creds, code);
    if (!tokens.refresh_token) {
      // Sem refresh_token (re-consentimento sem prompt=consent) → não dá p/ sincronizar offline.
      return backToApp(redirectBase, "error");
    }

    const primary = await getPrimaryCalendar(tokens.access_token);
    const email = primary?.id ?? null;
    const calendarId = primary?.id ?? "primary";
    const calendarName = primary?.summary ?? "Agenda principal";
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

    // 3) Conexão (metadado). Find-or-update espelhando EXATAMENTE o índice unique
    //    (clinic_id, professional_id, provider, google_account_email) — determinístico (no máx. 1 linha),
    //    evita erro do maybeSingle com múltiplas linhas e overwrite da conexão de outro profissional.
    let query = db
      .from("calendar_connections")
      .select("id")
      .eq("clinic_id", stateRow.clinic_id)
      .eq("provider", "google");
    query = stateRow.professional_id
      ? query.eq("professional_id", stateRow.professional_id)
      : query.is("professional_id", null);
    query = email ? query.eq("google_account_email", email) : query.is("google_account_email", null);
    const { data: existing } = await query.maybeSingle();

    const meta = {
      clinic_id: stateRow.clinic_id,
      professional_id: stateRow.professional_id,
      provider: "google",
      google_account_email: email,
      google_calendar_id: calendarId,
      calendar_name: calendarName,
      scopes: tokens.scope ?? GOOGLE_SCOPES.join(" "),
      status: "connected",
      updated_at: new Date().toISOString(),
    };

    let connectionId: string;
    if (existing?.id) {
      await db.from("calendar_connections").update(meta).eq("id", existing.id);
      connectionId = existing.id;
    } else {
      const { data: inserted, error: insErr } = await db
        .from("calendar_connections")
        .insert(meta)
        .select("id")
        .single();
      if (insErr || !inserted) return backToApp(redirectBase, "error");
      connectionId = inserted.id;
    }

    // 4) Tokens (cifrados EM REPOUSO, deny-all): gravados só aqui, via RPC service-role-only
    //    set_calendar_tokens (pgcrypto + chave no Vault). O client não tem caminho até o token. (WP-A2)
    const { error: tokErr } = await db.rpc("set_calendar_tokens", {
      p_connection_id: connectionId,
      p_refresh_token: tokens.refresh_token,
      p_access_token: tokens.access_token,
      p_token_expires_at: expiresAt,
    });
    if (tokErr) return backToApp(redirectBase, "error");

    return backToApp(redirectBase, "connected");
  } catch (_e) {
    return backToApp(redirectBase, "error");
  }
});
