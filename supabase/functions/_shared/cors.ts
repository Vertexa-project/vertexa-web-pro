// CORS + JSON helpers compartilhados pelas Edge Functions do Google Calendar (S10).
// As funções de init/sync/disconnect são chamadas pelo SPA via supabase.functions.invoke (POST);
// o callback é um redirect do Google (GET) e não precisa de CORS (responde 302).

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Resposta padrão ao preflight OPTIONS. */
export function preflight(): Response {
  return new Response("ok", { headers: corsHeaders });
}
