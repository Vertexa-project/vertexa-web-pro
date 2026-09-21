import { supabase } from "@/lib/supabase";
import {
  emptyCommercialMetrics,
  type ClinicCommercialUsage,
  type ClinicFounderContext,
  type CommercialCapacity,
  type CommercialPlanOption,
  type CommercialPriceBreakdown,
  type FounderBenefitStatus,
  type FounderCampaignStatus,
  type PlatformCommercialGovernance,
  type PlatformFounderAdmissionRow,
  type PricingReason,
} from "@/lib/domain/billingCommercial";

function asInt(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function mapPrice(raw: Record<string, unknown> | null | undefined, clinicId: string): CommercialPriceBreakdown {
  const reason = String(raw?.pricing_reason ?? "no_active_contract") as PricingReason;
  return {
    clinicId: String(raw?.clinic_id ?? clinicId),
    hasActiveContract: asBool(raw?.has_active_contract),
    planCode: typeof raw?.plan_code === "string" ? raw.plan_code : null,
    contractedPlanVersion: typeof raw?.contracted_plan_version === "number" ? raw.contracted_plan_version : null,
    currentTableVersion: typeof raw?.current_table_version === "number" ? raw.current_table_version : null,
    tablePriceCents: asInt(raw?.table_price_cents),
    lockedPriceCents: raw?.locked_price_cents == null ? null : asInt(raw.locked_price_cents),
    founderAdjustmentCents: asInt(raw?.founder_adjustment_cents),
    additionalCapacityCents: asInt(raw?.additional_capacity_cents),
    finalProjectedCents: asInt(raw?.final_projected_cents),
    pricingReason: reason,
    founderEligible: asBool(raw?.founder_eligible),
    lockUntil: typeof raw?.lock_until === "string" ? raw.lock_until : null,
    lifetimeDiscountBps: raw?.lifetime_discount_bps == null ? null : asInt(raw.lifetime_discount_bps),
    additionalProfessionalUnits: asInt(raw?.additional_professional_units),
    additionalPatientUnits: asInt(raw?.additional_patient_units),
    adjustmentsApplied: asInt(raw?.adjustments_applied),
    projectionNotCharge: true,
  };
}

function mapCapacity(raw: Record<string, unknown> | null | undefined, clinicId: string): CommercialCapacity {
  return {
    clinicId: String(raw?.clinic_id ?? clinicId),
    hasActiveContract: asBool(raw?.has_active_contract),
    planCode: typeof raw?.plan_code === "string" ? raw.plan_code : null,
    ownerExempt: 1,
    billableProfessionals: asInt(raw?.billable_professionals),
    includedProfessionals: asInt(raw?.included_professionals),
    additionalProfessionalUnits: asInt(raw?.additional_professional_units),
    allowedProfessionals: asInt(raw?.allowed_professionals),
    remainingProfessionals: asInt(raw?.remaining_professionals),
    professionalsExceeded: asBool(raw?.professionals_exceeded),
    activePatients: asInt(raw?.active_patients),
    includedPatients: asInt(raw?.included_patients),
    additionalPatientUnits: asInt(raw?.additional_patient_units),
    allowedPatients: asInt(raw?.allowed_patients),
    remainingPatients: asInt(raw?.remaining_patients),
    patientsExceeded: asBool(raw?.patients_exceeded),
    enforced: asBool(raw?.enforced),
  };
}

function mapFounder(raw: Record<string, unknown> | null | undefined): ClinicFounderContext | null {
  if (!raw || typeof raw.slot_number !== "number") return null;
  return {
    badge: asBool(raw.badge),
    benefitStatus: String(raw.benefit_status ?? "historical_only") as FounderBenefitStatus,
    slotNumber: raw.slot_number,
    lockUntil: typeof raw.lock_until === "string" ? raw.lock_until : null,
    lifetimeDiscountBps: asInt(raw.lifetime_discount_bps),
    initialFounderPriceCents: asInt(raw.initial_founder_price_cents),
    historical: true,
  };
}

export function mapClinicCommercialUsage(raw: Record<string, unknown>, clinicId: string): ClinicCommercialUsage {
  return {
    capacity: mapCapacity((raw.capacity ?? {}) as Record<string, unknown>, clinicId),
    price: mapPrice((raw.price ?? {}) as Record<string, unknown>, clinicId),
    founder: mapFounder((raw.founder ?? null) as Record<string, unknown> | null),
    entitlementEnforcement: "OFF",
    projectionNotCharge: true,
  };
}

function mapAdmission(raw: Record<string, unknown>): PlatformFounderAdmissionRow | null {
  if (!raw.clinic_id || !raw.clinic_name || typeof raw.slot_number !== "number") return null;
  return {
    clinicId: String(raw.clinic_id),
    clinicName: String(raw.clinic_name),
    slotNumber: raw.slot_number,
    benefitStatus: String(raw.benefit_status ?? "historical_only") as FounderBenefitStatus,
    planCode: String(raw.plan_code ?? ""),
    lockUntil: typeof raw.lock_until === "string" ? raw.lock_until : null,
    lifetimeDiscountBps: asInt(raw.lifetime_discount_bps),
    cancelledAt: typeof raw.cancelled_at === "string" ? raw.cancelled_at : null,
  };
}

export function mapPlatformCommercialGovernance(raw: Record<string, unknown>): PlatformCommercialGovernance {
  const empty = emptyCommercialMetrics();
  const byPlan = (raw.founder_clinics_by_plan ?? {}) as Record<string, unknown>;
  const founderClinicsByPlan: Record<string, number> = {};
  for (const [key, value] of Object.entries(byPlan)) {
    founderClinicsByPlan[key] = asInt(value);
  }
  return {
    ...empty,
    founderCampaignStatus: (raw.founder_campaign_status as FounderCampaignStatus | "missing") ?? "missing",
    founderAdmissionsUsed: asInt(raw.founder_admissions_used),
    founderAdmissionsRemaining: asInt(raw.founder_admissions_remaining, 50),
    founderActive: asInt(raw.founder_active),
    founderHistorical: asInt(raw.founder_historical),
    founderClinicsByPlan,
    standardProjectedBaseCents: asInt(raw.standard_projected_base_cents),
    founderProjectedBaseCents: asInt(raw.founder_projected_base_cents),
    projectedCommercialDiscountCents: asInt(raw.projected_commercial_discount_cents),
    additionalProfessionalUnits: asInt(raw.additional_professional_units),
    additionalPatientUnits: asInt(raw.additional_patient_units),
    projectedAdditionalRevenueCents: asInt(raw.projected_additional_revenue_cents),
    professionalCapacityUsed: asInt(raw.professional_capacity_used),
    professionalCapacityAllowed: asInt(raw.professional_capacity_allowed),
    patientCapacityUsed: asInt(raw.patient_capacity_used),
    patientCapacityAllowed: asInt(raw.patient_capacity_allowed),
    projectionNotReceived: true,
    admissions: ((raw.admissions as Record<string, unknown>[] | undefined) ?? [])
      .map(mapAdmission)
      .filter((row): row is PlatformFounderAdmissionRow => row !== null),
  };
}

export async function getMyClinicCommercialUsage(clinicId: string): Promise<ClinicCommercialUsage> {
  const { data, error } = await supabase.rpc("get_my_clinic_commercial_usage", {
    p_clinic_id: clinicId,
  });
  if (error) throw error;
  return mapClinicCommercialUsage((data ?? {}) as Record<string, unknown>, clinicId);
}

export async function getPlatformCommercialGovernance(): Promise<PlatformCommercialGovernance> {
  const { data, error } = await supabase.rpc("get_platform_commercial_governance");
  if (error) throw error;
  return mapPlatformCommercialGovernance((data ?? {}) as Record<string, unknown>);
}

export async function getPlatformClinicCommercialDetail(clinicId: string): Promise<{
  price: CommercialPriceBreakdown;
  capacity: CommercialCapacity;
}> {
  const { data, error } = await supabase.rpc("get_platform_clinic_commercial_detail", {
    p_clinic_id: clinicId,
  });
  if (error) throw error;
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    price: mapPrice((raw.price ?? {}) as Record<string, unknown>, clinicId),
    capacity: mapCapacity((raw.capacity ?? {}) as Record<string, unknown>, clinicId),
  };
}

export async function listPlatformCommercialPlanOptions(): Promise<CommercialPlanOption[]> {
  const { data, error } = await supabase.rpc("list_platform_commercial_plan_options");
  if (error) throw error;
  const plans = ((data ?? {}) as { plans?: Record<string, unknown>[] }).plans ?? [];
  return plans
    .map((row) => {
      const code = row.code;
      if (code !== "pulse" && code !== "sync" && code !== "apex") return null;
      return {
        code,
        displayName: String(row.display_name ?? code),
        tablePriceCents: asInt(row.table_price_cents),
        founderPriceCents: row.founder_price_cents == null ? null : asInt(row.founder_price_cents),
        includedProfessionals: asInt(row.included_professionals),
        includedPatients: asInt(row.included_patients),
        additionalProfessionalPriceCents:
          row.additional_professional_price_cents == null
            ? null
            : asInt(row.additional_professional_price_cents),
        additionalPatientPriceCents:
          row.additional_patient_price_cents == null ? null : asInt(row.additional_patient_price_cents),
      };
    })
    .filter((row): row is CommercialPlanOption => row !== null);
}

export async function admitPlatformFounderClinic(clinicId: string, planCode: string): Promise<void> {
  const { error } = await supabase.rpc("admit_platform_founder_clinic", {
    p_clinic_id: clinicId,
    p_plan_code: planCode,
  });
  if (error) throw error;
}

export async function closePlatformFounderCampaign(): Promise<void> {
  const { error } = await supabase.rpc("close_platform_founder_campaign");
  if (error) throw error;
}

export async function markPlatformFounderClinicCancelled(clinicId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_platform_founder_clinic_cancelled", {
    p_clinic_id: clinicId,
  });
  if (error) throw error;
}

export async function restorePlatformFounderClinicEligibility(clinicId: string): Promise<void> {
  const { error } = await supabase.rpc("restore_platform_founder_clinic_eligibility", {
    p_clinic_id: clinicId,
  });
  if (error) throw error;
}

export async function setPlatformClinicAdditionalCapacity(input: {
  clinicId: string;
  additionalProfessionals: number;
  additionalPatients: number;
}): Promise<void> {
  const { error } = await supabase.rpc("set_platform_clinic_additional_capacity", {
    p_clinic_id: input.clinicId,
    p_additional_professionals: input.additionalProfessionals,
    p_additional_patients: input.additionalPatients,
  });
  if (error) throw error;
}
