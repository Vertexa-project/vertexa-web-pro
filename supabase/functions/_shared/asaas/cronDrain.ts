// WP-ASAAS-04C — orquestração do auto-drain (sandbox-only). Sem IDs, sem PII, sem body steering.
// Auth NÃO vive aqui: o Edge `asaas-processor-cron` autentica com withSupabase
// `{ auth: "secret:asaas_processor_cron" }` antes de chamar estas funções.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  readAsaasCredentials,
  resolveOutboundEnvironment,
  type AsaasCredentials,
  type AsaasEnvironment,
} from "./client.ts";
import { drainBillingEvents, type DrainResult } from "./processor.ts";

export const CRON_DRAIN_LIMIT = 25;
export const CRON_SECRET_NAME = "asaas_processor_cron";
export const CRON_AUTH_MODE = "secret:asaas_processor_cron" as const;
export const CRON_JOB_NAME = "vertexa-asaas-financial-drain";
export const CRON_SCHEDULE = "* * * * *";

export type MinimizedDrainResponse = {
  claimed: number;
  processed: number;
  ignored: number;
  failed: number;
  voided: number;
  skipped: number;
};

const SENSITIVE_RESPONSE_KEYS = [
  "outcomes",
  "paymentId",
  "customerId",
  "subscriptionId",
  "billingAccountId",
  "external_payment_id",
  "external_customer_id",
  "external_subscription_id",
  "payload",
  "payload_hash",
] as const;

/** Body do cron é ignorado: nenhum campo do client escolhe limit/env/IDs/estado. */
export function ignoreCronRequestBody(_body: unknown): void {
  return;
}

export function resolveCronAutomationEnvironment(
  raw: string | undefined,
): { ok: true; environment: "sandbox" } | { ok: false; error: "asaas_outbound_not_configured" | "auto_drain_sandbox_only" } {
  const env = resolveOutboundEnvironment(raw);
  if (!env) return { ok: false, error: "asaas_outbound_not_configured" };
  if (env !== "sandbox") return { ok: false, error: "auto_drain_sandbox_only" };
  return { ok: true, environment: "sandbox" };
}

export function minimizeDrainResponse(result: DrainResult): MinimizedDrainResponse {
  return {
    claimed: result.claimed,
    processed: result.processed,
    ignored: result.ignored,
    failed: result.failed,
    voided: result.voided,
    skipped: result.skipped,
  };
}

export function assertMinimizedResponse(body: Record<string, unknown>): boolean {
  return SENSITIVE_RESPONSE_KEYS.every((k) => !(k in body));
}

export async function runAutomatedSandboxDrain(params: {
  adminClient: SupabaseClient;
  environmentRaw: string | undefined;
  creds?: AsaasCredentials;
  drain?: typeof drainBillingEvents;
}): Promise<{ status: number; body: MinimizedDrainResponse | { error: string } }> {
  ignoreCronRequestBody(params);
  const envGate = resolveCronAutomationEnvironment(params.environmentRaw);
  if (!envGate.ok) {
    return { status: 503, body: { error: envGate.error } };
  }

  let credentials: AsaasCredentials;
  try {
    credentials = params.creds ?? readAsaasCredentials(envGate.environment);
  } catch {
    return { status: 503, body: { error: "asaas_not_configured" } };
  }

  const drain = params.drain ?? drainBillingEvents;
  try {
    const result = await drain({
      adminClient: params.adminClient,
      environment: envGate.environment,
      creds: credentials,
      limit: CRON_DRAIN_LIMIT,
    });
    return { status: 200, body: minimizeDrainResponse(result) };
  } catch {
    return { status: 502, body: { error: "drain_failed" } };
  }
}

/** Contrato oficial withSupabase({ auth: "secret:asaas_processor_cron" }). Só fixtures nos testes. */
export type PresentedCronCredential =
  | { kind: "none" }
  | { kind: "publishable" }
  | { kind: "user_jwt" }
  | { kind: "wrong_secret" }
  | { kind: "named_secret"; name: string };

export function authorizePresentedCronCredential(
  presented: PresentedCronCredential,
): { authorized: true } | { authorized: false; status: 401; error: "unauthorized" } {
  if (presented.kind === "named_secret" && presented.name === CRON_SECRET_NAME) {
    return { authorized: true };
  }
  return { authorized: false, status: 401, error: "unauthorized" };
}

export function cronDrainLimitFromClient(_raw: unknown): number {
  return CRON_DRAIN_LIMIT;
}

export type { AsaasEnvironment };
