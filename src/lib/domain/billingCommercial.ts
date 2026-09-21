import { formatBillingPriceCents } from "./billingCheckout";

export const FOUNDER_MAX_ADMISSIONS = 50;
export const FOUNDER_LOCK_MONTHS = 12;
export const FOUNDER_LIFETIME_DISCOUNT_BPS = 3000;
export const FOUNDER_CAMPAIGN_CODE = "founder_2026";

export type FounderBenefitStatus = "eligible" | "returnable" | "historical_only";
export type FounderCampaignStatus = "open" | "closed";
export type CommercialPlanCode = "pulse" | "sync" | "apex";
export type PricingReason = "founder_lock" | "founder_lifetime_table" | "standard_snapshot" | "no_active_contract";

export interface CommercialPriceBreakdown {
  clinicId: string;
  hasActiveContract: boolean;
  planCode: string | null;
  contractedPlanVersion: number | null;
  currentTableVersion: number | null;
  tablePriceCents: number;
  lockedPriceCents: number | null;
  founderAdjustmentCents: number;
  additionalCapacityCents: number;
  finalProjectedCents: number;
  pricingReason: PricingReason;
  founderEligible: boolean;
  lockUntil: string | null;
  lifetimeDiscountBps: number | null;
  additionalProfessionalUnits: number;
  additionalPatientUnits: number;
  adjustmentsApplied: number;
  projectionNotCharge: true;
}

export interface CommercialCapacity {
  clinicId: string;
  hasActiveContract: boolean;
  planCode: string | null;
  ownerExempt: 1;
  billableProfessionals: number;
  includedProfessionals: number;
  additionalProfessionalUnits: number;
  allowedProfessionals: number;
  remainingProfessionals: number;
  professionalsExceeded: boolean;
  activePatients: number;
  includedPatients: number;
  additionalPatientUnits: number;
  allowedPatients: number;
  remainingPatients: number;
  patientsExceeded: boolean;
  enforced: boolean;
}

export interface ClinicFounderContext {
  badge: boolean;
  benefitStatus: FounderBenefitStatus;
  slotNumber: number;
  lockUntil: string | null;
  lifetimeDiscountBps: number;
  initialFounderPriceCents: number;
  historical: true;
}

export interface ClinicCommercialUsage {
  capacity: CommercialCapacity;
  price: CommercialPriceBreakdown;
  founder: ClinicFounderContext | null;
  entitlementEnforcement: "OFF";
  projectionNotCharge: true;
}

export interface PlatformFounderAdmissionRow {
  clinicId: string;
  clinicName: string;
  slotNumber: number;
  benefitStatus: FounderBenefitStatus;
  planCode: string;
  lockUntil: string | null;
  lifetimeDiscountBps: number;
  cancelledAt: string | null;
}

export interface PlatformCommercialMetrics {
  founderCampaignStatus: FounderCampaignStatus | "missing";
  founderAdmissionsUsed: number;
  founderAdmissionsRemaining: number;
  founderActive: number;
  founderHistorical: number;
  founderClinicsByPlan: Record<string, number>;
  standardProjectedBaseCents: number;
  founderProjectedBaseCents: number;
  projectedCommercialDiscountCents: number;
  additionalProfessionalUnits: number;
  additionalPatientUnits: number;
  projectedAdditionalRevenueCents: number;
  professionalCapacityUsed: number;
  professionalCapacityAllowed: number;
  patientCapacityUsed: number;
  patientCapacityAllowed: number;
  projectionNotReceived: true;
}

export interface PlatformCommercialGovernance extends PlatformCommercialMetrics {
  admissions: PlatformFounderAdmissionRow[];
}

export interface CommercialPlanOption {
  code: CommercialPlanCode;
  displayName: string;
  tablePriceCents: number;
  founderPriceCents: number | null;
  includedProfessionals: number;
  includedPatients: number;
  additionalProfessionalPriceCents: number | null;
  additionalPatientPriceCents: number | null;
}

export function resolveFounderBaseCents(input: {
  founderEligible: boolean;
  asOfDate: string;
  lockUntil: string | null;
  lockedFounderCents: number;
  tablePriceCents: number;
  lifetimeDiscountBps: number;
  contractedSnapshotCents: number;
}): { baseCents: number; reason: PricingReason; lockedPriceCents: number | null } {
  if (!input.founderEligible) {
    return {
      baseCents: input.contractedSnapshotCents,
      reason: "standard_snapshot",
      lockedPriceCents: null,
    };
  }
  if (input.lockUntil && input.asOfDate < input.lockUntil) {
    return {
      baseCents: input.lockedFounderCents,
      reason: "founder_lock",
      lockedPriceCents: input.lockedFounderCents,
    };
  }
  return {
    baseCents: Math.trunc((input.tablePriceCents * (10000 - input.lifetimeDiscountBps)) / 10000),
    reason: "founder_lifetime_table",
    lockedPriceCents: null,
  };
}

export function additionalCapacityCents(input: {
  planCode: CommercialPlanCode | string | null;
  professionalUnits: number;
  patientUnits: number;
  professionalUnitCents: number | null;
  patientUnitCents: number | null;
}): { cents: number; pulseAddonBlocked: boolean } {
  const prof = input.professionalUnits;
  const pat = input.patientUnits;
  if (prof <= 0 && pat <= 0) return { cents: 0, pulseAddonBlocked: false };
  if (input.professionalUnitCents == null && prof > 0) {
    return { cents: 0, pulseAddonBlocked: true };
  }
  if (input.patientUnitCents == null && pat > 0) {
    return { cents: 0, pulseAddonBlocked: true };
  }
  return {
    cents: prof * (input.professionalUnitCents ?? 0) + pat * (input.patientUnitCents ?? 0),
    pulseAddonBlocked: false,
  };
}

export function resolveProjectedCents(input: {
  founderEligible: boolean;
  asOfDate: string;
  lockUntil: string | null;
  lockedFounderCents: number;
  tablePriceCents: number;
  lifetimeDiscountBps: number;
  contractedSnapshotCents: number;
  planCode: CommercialPlanCode | string | null;
  professionalUnits: number;
  patientUnits: number;
  professionalUnitCents: number | null;
  patientUnitCents: number | null;
}): { finalProjectedCents: number; reason: PricingReason; pulseAddonBlocked: boolean } {
  const base = resolveFounderBaseCents(input);
  const extra = additionalCapacityCents(input);
  return {
    finalProjectedCents: extra.pulseAddonBlocked ? base.baseCents : base.baseCents + extra.cents,
    reason: base.reason,
    pulseAddonBlocked: extra.pulseAddonBlocked,
  };
}

export function nextFounderSlot(usedSlots: number[]): number | null {
  const used = new Set(usedSlots);
  for (let slot = 1; slot <= FOUNDER_MAX_ADMISSIONS; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

export function canReuseCancelledFounderSlot(input: {
  campaignOpen: boolean;
  sameClinic: boolean;
  historicalSlot: number;
}): { reuseSameSlot: boolean; consumeNewSlot: boolean; restoreBenefit: boolean } {
  if (!input.sameClinic) {
    return { reuseSameSlot: false, consumeNewSlot: true, restoreBenefit: input.campaignOpen };
  }
  if (input.campaignOpen) {
    return { reuseSameSlot: true, consumeNewSlot: false, restoreBenefit: true };
  }
  return { reuseSameSlot: true, consumeNewSlot: false, restoreBenefit: false };
}

export function billableProfessionalCount(input: {
  ownerProfileId: string;
  members: Array<{ profileId: string; status: string }>;
}): number {
  return input.members.filter(
    (member) => member.status === "active" && member.profileId !== input.ownerProfileId,
  ).length;
}

export function allowedCapacity(included: number, additionalUnits: number): number {
  return included + Math.max(additionalUnits, 0);
}

export function capacityNotice(input: {
  remaining: number;
  allowed: number;
  kind: "professional" | "patient";
  planCode: string | null;
  canAddUnits: boolean;
}): { tone: "ok" | "near" | "limit"; title: string; body: string } {
  const singular = input.kind === "professional" ? "profissional" : "paciente";
  const plural = input.kind === "professional" ? "profissionais" : "pacientes";
  if (!input.allowed && input.remaining === 0) {
    return { tone: "ok", title: "", body: "" };
  }
  if (input.remaining <= 0) {
    const addon =
      input.canAddUnits && (input.planCode === "sync" || input.planCode === "apex")
        ? " O administrador da plataforma pode contratar unidades adicionais. Isto não é compra automática."
        : input.planCode === "pulse"
          ? " O plano Pulse não tem unidade adicional nesta campanha."
          : "";
    return {
      tone: "limit",
      title: `Limite de ${plural} atingido`,
      body: `Não é possível tornar outro ${singular} ativo. Capacidade permitida: ${input.allowed}.${addon}`,
    };
  }
  if (input.remaining <= 2) {
    const word = input.remaining === 1 ? singular : plural;
    return {
      tone: "near",
      title: `${input.remaining} ${word} restante${input.remaining === 1 ? "" : "s"}`,
      body: `Uso comercial: ${input.allowed - input.remaining} de ${input.allowed}.`,
    };
  }
  return {
    tone: "ok",
    title: `${input.remaining} ${plural} restantes`,
    body: `Uso comercial: ${input.allowed - input.remaining} de ${input.allowed}.`,
  };
}

export function founderBadgeLabel(founder: ClinicFounderContext | null): string | null {
  if (!founder) return null;
  if (founder.badge) return "Founder Member";
  if (founder.benefitStatus === "returnable") return "Founder histórico (retorno possível)";
  return "Founder histórico";
}

export function pricingReasonLabel(reason: PricingReason): string {
  switch (reason) {
    case "founder_lock":
      return "Preço Founder travado";
    case "founder_lifetime_table":
      return "70% da tabela vigente (benefício vitalício)";
    case "standard_snapshot":
      return "Preço contratado da tabela";
    default:
      return "Sem contrato ativo";
  }
}

export function commercialMoney(cents: number): string {
  return formatBillingPriceCents(cents);
}

export function emptyCommercialMetrics(): PlatformCommercialMetrics {
  return {
    founderCampaignStatus: "open",
    founderAdmissionsUsed: 0,
    founderAdmissionsRemaining: FOUNDER_MAX_ADMISSIONS,
    founderActive: 0,
    founderHistorical: 0,
    founderClinicsByPlan: {},
    standardProjectedBaseCents: 0,
    founderProjectedBaseCents: 0,
    projectedCommercialDiscountCents: 0,
    additionalProfessionalUnits: 0,
    additionalPatientUnits: 0,
    projectedAdditionalRevenueCents: 0,
    professionalCapacityUsed: 0,
    professionalCapacityAllowed: 0,
    patientCapacityUsed: 0,
    patientCapacityAllowed: 0,
    projectionNotReceived: true,
  };
}

export function futureAdjustmentPreview(input: {
  kind: "percentage" | "fixed_cents";
  percentBps?: number;
  amountCents?: number;
  baseCents: number;
}): number {
  if (input.kind === "percentage") {
    return Math.trunc((input.baseCents * (10000 - (input.percentBps ?? 0))) / 10000);
  }
  return Math.max(input.baseCents - (input.amountCents ?? 0), 0);
}

export function commercialErrorMessage(error: unknown): string {
  const hint =
    error && typeof error === "object" && "hint" in error
      ? String((error as { hint?: unknown }).hint ?? "")
      : "";
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  const code = `${hint} ${message}`;
  if (code.includes("BILLING_NOT_PLATFORM_ADMIN")) return "Apenas o administrador da plataforma pode fazer isto.";
  if (code.includes("BILLING_NOT_CLINIC_ADMIN")) return "Apenas o administrador da clínica pode ver este uso.";
  if (code.includes("BILLING_FOUNDER_CAMPAIGN_CLOSED")) return "A campanha Founder está encerrada.";
  if (code.includes("BILLING_FOUNDER_SLOTS_EXHAUSTED")) return "Os 50 slots históricos Founder já foram usados.";
  if (code.includes("BILLING_FOUNDER_ALREADY_ADMITTED")) return "Esta clínica já possui admissão Founder nesta campanha.";
  if (code.includes("BILLING_FOUNDER_RETURN_AFTER_CLOSE")) {
    return "A campanha encerrou. O benefício Founder não é restaurado. O histórico permanece visível.";
  }
  if (code.includes("BILLING_PULSE_NO_ADDON")) return "Pulse não tem unidade adicional nesta campanha.";
  if (code.includes("BILLING_PROFESSIONAL_CAPACITY")) {
    return "A clínica atingiu o limite de profissionais ativos (o dono responsável não conta).";
  }
  if (code.includes("BILLING_PATIENT_CAPACITY")) return "A clínica atingiu o limite de pacientes ativos.";
  if (code.includes("BILLING_OWNER_LOCKED_FOR_CAPACITY")) {
    return "O dono responsável não pode ser trocado para burlar o assento comercial.";
  }
  return "Não foi possível concluir a ação comercial agora.";
}
