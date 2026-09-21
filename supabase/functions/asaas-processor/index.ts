// WP-ASAAS-04 — processor Vertexa dos eventos financeiros Asaas (drain).
// Caller = Vertexa authenticated (verify_jwt=true), platform_admin nesta WP (mesmo gate
// temporário do asaas-outbound). Nunca Asaas, nunca browser anônimo.
//
// Server-derived: provider ('asaas'), environment (ASAAS_OUTBOUND_ENVIRONMENT) e credenciais.
// NUNCA aceita do body: provider, environment, paymentId, subscriptionId, customerId,
// billingAccountId, price/value, status, financial_state. O único parâmetro aceito é `limit`
// (clamp 1..25) — teto de eventos por drain. Sem loop quente: um drain = um claim + um passe.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { supabaseUser } from "../_shared/supabaseUser.ts";
import { readAsaasCredentials, resolveOutboundEnvironment } from "../_shared/asaas/client.ts";
import { drainBillingEvents } from "../_shared/asaas/processor.ts";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface RequestBody {
  action?: string;
  limit?: unknown;
}

function clampLimit(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  const n = Math.floor(raw);
  if (n < 1) return 1;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  // Platform admin gate ANTES de qualquer inspeção de config/body (temporário, igual
  // asaas-outbound). Um authenticated não-admin não deve sequer descobrir se o Asaas está
  // configurado — só platform_admin dispara drain.
  const userClient = supabaseUser(req);
  const { data: isAdmin, error: adminError } = await userClient.rpc("am_i_platform_admin");
  if (adminError) {
    return jsonResponse(401, { error: "unauthorized" });
  }
  if (!isAdmin) {
    return jsonResponse(403, { error: "forbidden" });
  }

  const sandbox = resolveOutboundEnvironment("sandbox");
  const production = resolveOutboundEnvironment("production");
  const sandboxCreds = (() => {
    try {
      return readAsaasCredentials("sandbox");
    } catch {
      return null;
    }
  })();
  const productionCreds = (() => {
    try {
      return readAsaasCredentials("production");
    } catch {
      return null;
    }
  })();
  if (!sandboxCreds && !productionCreds) {
    return jsonResponse(503, { error: "asaas_not_configured" });
  }

  let body: RequestBody;
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as RequestBody) : {};
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (body.action !== "drain") {
    return jsonResponse(400, { error: "invalid_action" });
  }

  const limit = clampLimit(body.limit);
  const adminClient = supabaseAdmin();

  const environments: Array<{ environment: "sandbox" | "production"; creds: NonNullable<typeof sandboxCreds> }> = [];
  if (sandbox && sandboxCreds) environments.push({ environment: "sandbox", creds: sandboxCreds });
  if (production && productionCreds) environments.push({ environment: "production", creds: productionCreds });

  try {
    let claimed = 0;
    let processed = 0;
    let ignored = 0;
    let failed = 0;
    let voided = 0;
    let skipped = 0;
    const outcomes: unknown[] = [];
    for (const item of environments) {
      const result = await drainBillingEvents({
        adminClient,
        environment: item.environment,
        creds: item.creds,
        limit,
      });
      claimed += result.claimed;
      processed += result.processed;
      ignored += result.ignored;
      failed += result.failed;
      voided += result.voided;
      skipped += result.skipped;
      outcomes.push(...result.outcomes);
    }
    return jsonResponse(200, {
      limit,
      claimed,
      processed,
      ignored,
      failed,
      voided,
      skipped,
      outcomes,
    });
  } catch {
    return jsonResponse(502, { error: "drain_failed" });
  }
});
