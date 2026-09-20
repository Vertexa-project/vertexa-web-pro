import { supabase } from "@/lib/supabase";
import {
  ensureCustomerFromIdentityPayload,
  executeClinicPixPayload,
  prepareClinicPixPayload,
  type TransientPixQr,
} from "@/lib/domain/billingPixCheckout";

export interface ClinicPixPrepareResult {
  outcome: "prepared";
  authorizationId: string;
  providerStatus: string;
  generation: number;
  operationId: string;
  retryPolicy: "ALLOW_THREE_IN_SEVEN_DAYS";
  paymentCreationMode: "SUBSCRIPTION";
}

export interface ClinicPixExecuteResult {
  executed: true;
  authorizationStatus: string | null;
  qrAvailable: boolean;
  immediateQrCode?: TransientPixQr;
  qrUnavailableReason?: string;
}

export interface ClinicPixReissueResult {
  outcome: "reissued" | "already_reissued";
  oldAuthorizationId: string;
  newAuthorizationId: string;
  oldGeneration: number;
  newGeneration: number;
  newStatus: string;
  operationId: string | null;
}

async function invokeOutbound<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("asaas-outbound", { body });
  if (error) {
    let code = "pix_outbound_failed";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const payload = (await ctx.json()) as { error?: string };
        if (payload?.error) code = String(payload.error);
      } catch {
        // keep generic
      }
    }
    throw new Error(code);
  }
  return data as T;
}

export async function ensureMyClinicCustomerFromIdentity(clinicId: string): Promise<{ customerBound: true }> {
  return invokeOutbound(ensureCustomerFromIdentityPayload(clinicId));
}

export async function prepareMyClinicPixAutomaticAuthorization(
  clinicId: string,
): Promise<ClinicPixPrepareResult> {
  const { data, error } = await supabase.rpc("prepare_my_clinic_pix_automatic_authorization", {
    ...prepareClinicPixPayload(clinicId),
  });
  if (error) throw error;
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    outcome: "prepared",
    authorizationId: String(raw.authorization_id ?? ""),
    providerStatus: String(raw.provider_status ?? ""),
    generation: Number(raw.generation ?? 0),
    operationId: String(raw.operation_id ?? ""),
    retryPolicy: "ALLOW_THREE_IN_SEVEN_DAYS",
    paymentCreationMode: "SUBSCRIPTION",
  };
}

export async function executeMyClinicPixAutomaticAuthorization(
  operationId: string,
): Promise<ClinicPixExecuteResult> {
  return invokeOutbound(executeClinicPixPayload(operationId));
}

export async function reissueMyClinicPixAutomaticAuthorization(input: {
  clinicId: string;
  reason?: string;
}): Promise<ClinicPixReissueResult> {
  const { data, error } = await supabase.rpc("reissue_my_clinic_pix_automatic_authorization", {
    p_clinic_id: input.clinicId,
    p_reason: input.reason ?? null,
  });
  if (error) throw error;
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    outcome: raw.outcome === "already_reissued" ? "already_reissued" : "reissued",
    oldAuthorizationId: String(raw.old_authorization_id ?? ""),
    newAuthorizationId: String(raw.new_authorization_id ?? ""),
    oldGeneration: Number(raw.old_generation ?? 0),
    newGeneration: Number(raw.new_generation ?? 0),
    newStatus: String(raw.new_status ?? ""),
    operationId: typeof raw.operation_id === "string" ? raw.operation_id : null,
  };
}
