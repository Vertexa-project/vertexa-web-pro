// WP-ASAAS-02 — stub de webhook Asaas.
// Caller = Asaas (verify_jwt=false). Auth real = header asaas-access-token.
// Environment: somente ASAAS_WEBHOOK_ENVIRONMENT=sandbox|production (fail-closed).
// Sem HTTP outbound. Sem grant. Sem estado comercial.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { dispatchAsaasWebhook } from "../_shared/asaasWebhook.js";

Deno.serve(async (req: Request) => {
  return dispatchAsaasWebhook(req, {
    environmentRaw: Deno.env.get("ASAAS_WEBHOOK_ENVIRONMENT"),
    sandboxToken: Deno.env.get("ASAAS_WEBHOOK_AUTH_TOKEN_SANDBOX"),
    productionToken: Deno.env.get("ASAAS_WEBHOOK_AUTH_TOKEN_PRODUCTION"),
    ingest: async (row) => {
      const db = supabaseAdmin();
      const { data, error } = await db.rpc("ingest_billing_provider_event", {
        p_provider: row.provider,
        p_environment: row.environment,
        p_external_event_id: row.externalEventId,
        p_event_type: row.eventType,
        p_event_created_at: row.eventCreatedAt,
        p_external_resource_type: row.externalResourceType,
        p_external_resource_id: row.externalResourceId,
        p_payload_hash: row.payloadHash,
        p_provider_facts: row.providerFacts ?? null,
      });
      if (error || !data || typeof data !== "object") {
        return { outcome: "error" };
      }
      const outcome = (data as { outcome?: string }).outcome;
      return { outcome: outcome ?? "error" };
    },
  });
});
