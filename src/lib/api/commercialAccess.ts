import { supabase } from "@/lib/supabase";
import type {
  CommercialAccessClass,
  CommercialAccessReason,
  CommercialRolloutMode,
  ProviderWriteMode,
} from "@/lib/domain/commercialAccess";

export interface ClinicCommercialAccess {
  clinicId: string;
  accessClass: CommercialAccessClass;
  reason: CommercialAccessReason;
  productAllowed: boolean;
  rolloutMode: CommercialRolloutMode;
}

export interface PlatformCommercialAccessClinic {
  clinicId: string;
  clinicName: string;
  clinicStatus: string;
  accessClass: CommercialAccessClass;
  reason: CommercialAccessReason;
  productAllowed: boolean;
  hasActiveContract: boolean;
  hasActiveExemption: boolean;
  hasSandboxAccount: boolean;
  hasProductionAccount: boolean;
}

export interface PlatformCommercialExemption {
  id: string;
  clinicId: string;
  clinicName: string;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  active: boolean;
}

export interface PlatformCommercialAccessOverview {
  rolloutMode: CommercialRolloutMode;
  providerWriteMode: ProviderWriteMode;
  entitlementEnforcement: "OFF";
  clinics: PlatformCommercialAccessClinic[];
  exemptions: PlatformCommercialExemption[];
  canaryClinics: Array<{ clinicId: string; allowedOperations: string[] }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function mapClinicCommercialAccess(raw: unknown, fallbackClinicId: string): ClinicCommercialAccess {
  const rec = asRecord(raw) ?? {};
  return {
    clinicId: String(rec.clinic_id ?? fallbackClinicId),
    accessClass: String(rec.access_class ?? "PRE_CONTRACT") as CommercialAccessClass,
    reason: String(rec.reason ?? "NO_ACTIVE_CONTRACT") as CommercialAccessReason,
    productAllowed: rec.product_allowed === true,
    rolloutMode: String(rec.rollout_mode ?? "OBSERVE") as CommercialRolloutMode,
  };
}

export async function getMyClinicCommercialAccess(clinicId: string): Promise<ClinicCommercialAccess> {
  const { data, error } = await supabase.rpc("get_my_clinic_commercial_access", {
    p_clinic_id: clinicId,
  });
  if (error) throw error;
  const rec = asRecord(data);
  if (
    !rec ||
    typeof rec.product_allowed !== "boolean" ||
    typeof rec.access_class !== "string" ||
    typeof rec.rollout_mode !== "string"
  ) {
    const malformed = new Error("COMMERCIAL_ACCESS_MALFORMED");
    (malformed as { hint?: string; code?: string }).hint = "COMMERCIAL_ACCESS_MALFORMED";
    (malformed as { hint?: string; code?: string }).code = "COMMERCIAL_ACCESS_MALFORMED";
    throw malformed;
  }
  return mapClinicCommercialAccess(data, clinicId);
}

export async function listPlatformCommercialAccess(): Promise<PlatformCommercialAccessOverview> {
  const { data, error } = await supabase.rpc("list_platform_commercial_access");
  if (error) throw error;
  const rec = asRecord(data) ?? {};
  const clinics = Array.isArray(rec.clinics) ? rec.clinics : [];
  const exemptions = Array.isArray(rec.exemptions) ? rec.exemptions : [];
  const canary = Array.isArray(rec.canary_clinics) ? rec.canary_clinics : [];
  return {
    rolloutMode: String(rec.rollout_mode ?? "OBSERVE") as CommercialRolloutMode,
    providerWriteMode: String(rec.provider_write_mode ?? "LOCKED") as ProviderWriteMode,
    entitlementEnforcement: "OFF",
    clinics: clinics.map((row) => {
      const item = asRecord(row) ?? {};
      return {
        clinicId: String(item.clinic_id ?? ""),
        clinicName: String(item.clinic_name ?? ""),
        clinicStatus: String(item.clinic_status ?? "active"),
        accessClass: String(item.access_class ?? "PRE_CONTRACT") as CommercialAccessClass,
        reason: String(item.reason ?? "NO_ACTIVE_CONTRACT") as CommercialAccessReason,
        productAllowed: item.product_allowed === true,
        hasActiveContract: item.has_active_contract === true,
        hasActiveExemption: item.has_active_exemption === true,
        hasSandboxAccount: item.has_sandbox_account === true,
        hasProductionAccount: item.has_production_account === true,
      };
    }),
    exemptions: exemptions.map((row) => {
      const item = asRecord(row) ?? {};
      return {
        id: String(item.id ?? ""),
        clinicId: String(item.clinic_id ?? ""),
        clinicName: String(item.clinic_name ?? ""),
        reason: String(item.reason ?? ""),
        createdAt: String(item.created_at ?? ""),
        expiresAt: typeof item.expires_at === "string" ? item.expires_at : null,
        revokedAt: typeof item.revoked_at === "string" ? item.revoked_at : null,
        active: item.active === true,
      };
    }),
    canaryClinics: canary.map((row) => {
      const item = asRecord(row) ?? {};
      return {
        clinicId: String(item.clinic_id ?? ""),
        allowedOperations: Array.isArray(item.allowed_operations)
          ? item.allowed_operations.map((op) => String(op))
          : [],
      };
    }),
  };
}

export async function setPlatformCommercialAccessMode(mode: "observe" | "enforce"): Promise<void> {
  const { error } = await supabase.rpc("set_platform_commercial_access_mode", { p_mode: mode });
  if (error) throw error;
}

export async function grantPlatformCommercialAccessExemption(input: {
  clinicId: string;
  reason: string;
  expiresAt?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("grant_platform_commercial_access_exemption", {
    p_clinic_id: input.clinicId,
    p_reason: input.reason,
    p_expires_at: input.expiresAt ?? null,
  });
  if (error) throw error;
}

export async function revokePlatformCommercialAccessExemption(exemptionId: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_platform_commercial_access_exemption", {
    p_exemption_id: exemptionId,
  });
  if (error) throw error;
}

export async function setPlatformProviderWriteMode(mode: "locked" | "canary" | "open"): Promise<void> {
  const { error } = await supabase.rpc("set_platform_provider_write_mode", { p_mode: mode });
  if (error) throw error;
}
