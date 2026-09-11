// WP-ASAAS-04C — worker automático do processor financeiro (sandbox-only).
// Caller = máquina. Auth oficial: withSupabase({ auth: "secret:asaas_processor_cron" }).
// verify_jwt=false no config.toml NÃO torna a função pública — sem a named secret → 401.
//
// NÃO é o asaas-processor humano (JWT Platform Admin). Reutiliza o mesmo drainBillingEvents.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@1.5.3";
import {
  CRON_AUTH_MODE,
  ignoreCronRequestBody,
  runAutomatedSandboxDrain,
} from "../_shared/asaas/cronDrain.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const handler = withSupabase({ auth: CRON_AUTH_MODE, cors: "disabled" }, async (req, ctx) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  let body: unknown = {};
  try {
    const raw = await req.text();
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = {};
  }
  ignoreCronRequestBody(body);

  const out = await runAutomatedSandboxDrain({
    adminClient: ctx.supabaseAdmin,
    environmentRaw: Deno.env.get("ASAAS_OUTBOUND_ENVIRONMENT"),
  });
  return jsonResponse(out.status, out.body);
});

Deno.serve(handler);
