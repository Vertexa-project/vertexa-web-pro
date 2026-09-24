import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AsaasEnvironment } from "./client.ts";

export const PRODUCTION_FIXTURE_FORBIDDEN = "production_fixture_forbidden";
export const PRODUCTION_LOCKED = "production_locked";

export function assertSandboxFixtureEnvironment(
  environment: AsaasEnvironment,
): { ok: true } | { ok: false; error: string } {
  if (environment !== "sandbox") return { ok: false, error: PRODUCTION_FIXTURE_FORBIDDEN };
  return { ok: true };
}

export async function assertProductionProviderWriteForAccount(
  adminClient: SupabaseClient,
  billingAccountId: string,
  operationType: "ENSURE_CUSTOMER_FROM_IDENTITY" | "PIX_AUTOMATIC_CREATE" | "HOSTED_CARD_CHECKOUT_CREATE",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await adminClient.rpc("assert_billing_production_provider_write_for_account", {
    p_billing_account_id: billingAccountId,
    p_operation_type: operationType,
  });
  if (error) return { ok: false, error: PRODUCTION_LOCKED };
  if (data && typeof data === "object" && (data as { allowed?: boolean }).allowed === true) {
    return { ok: true };
  }
  return { ok: false, error: PRODUCTION_LOCKED };
}

export async function assertProductionProviderWriteForClinic(
  adminClient: SupabaseClient,
  clinicId: string,
  operationType: "ENSURE_CUSTOMER_FROM_IDENTITY" | "PIX_AUTOMATIC_CREATE" | "HOSTED_CARD_CHECKOUT_CREATE",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await adminClient.rpc("assert_billing_production_provider_write", {
    p_clinic_id: clinicId,
    p_operation_type: operationType,
  });
  if (error) return { ok: false, error: PRODUCTION_LOCKED };
  if (data && typeof data === "object" && (data as { allowed?: boolean }).allowed === true) {
    return { ok: true };
  }
  return { ok: false, error: PRODUCTION_LOCKED };
}
