import { supabase } from "@/lib/supabase";
import type { PixAuthorizationStatus } from "@/lib/domain/billingCheckout";
import {
  emptyBillingOverview,
  isBillingMethod,
  isBillingProviderEnvironment,
  isChargeDisplayState,
  isPaymentDisplayState,
  isTimelineEventType,
  type BillingMethod,
  type ClinicBillingCharge,
  type ClinicBillingOverview,
  type ClinicBillingPayment,
  type ClinicBillingPlanSummary,
  type ClinicBillingTimelineEvent,
  type FinancialSummaryCode,
} from "@/lib/domain/billingHub";

interface RawPlan {
  id?: string;
  status?: string;
  plan_display_name?: string;
  display_name?: string;
  price_cents?: number;
  currency?: string;
  billing_cycle?: string;
}

interface RawNextCharge {
  amount_cents?: number;
  currency?: string;
  due_date?: string;
  display_state?: string;
}

interface RawSituation {
  summary_code?: string;
  attention?: boolean;
  overdue_count?: number;
  overdue_cents?: number | null;
}

interface RawOverview {
  clinic_id?: string;
  plan?: RawPlan | null;
  pix_authorization_status?: string | null;
  pix_generation?: number | null;
  identity_complete?: boolean;
  next_charge?: RawNextCharge | null;
  financial_situation?: RawSituation;
  latest_payment_display_state?: string | null;
  charge_count?: number;
  entitlement_enforcement?: string;
  entitlement_granted?: boolean;
}

interface RawCharge {
  id?: string;
  amount_cents?: number;
  currency?: string;
  due_date?: string | null;
  paid_date?: string | null;
  display_state?: string;
  method?: string;
}

interface RawPayment {
  id?: string;
  amount_cents?: number;
  currency?: string;
  due_date?: string | null;
  received_date?: string | null;
  display_state?: string;
  method?: string;
}

interface RawEvent {
  id?: string;
  occurred_at?: string;
  type?: string;
  environment?: string | null;
}

interface RawList<T> {
  clinic_id?: string;
  items?: T[];
}

function assertOwnClinic(clinicId: string, rawClinicId: string | undefined): void {
  if (rawClinicId && rawClinicId !== clinicId) {
    const err = new Error("BILLING_CLINIC_MISMATCH");
    (err as { hint?: string }).hint = "BILLING_NOT_CLINIC_ADMIN";
    throw err;
  }
}

function mapMethod(value: string | undefined): BillingMethod {
  return value && isBillingMethod(value) ? value : "UNDEFINED";
}

function mapPlan(row: RawPlan | null | undefined): ClinicBillingPlanSummary | null {
  if (!row || typeof row.price_cents !== "number") return null;
  const displayName = row.plan_display_name ?? row.display_name;
  if (!displayName) return null;
  return {
    displayName,
    priceCents: row.price_cents,
    currency: row.currency === "BRL" ? "BRL" : "BRL",
    billingCycle: "monthly",
    contractStatus: row.status ?? "active",
  };
}

function mapOverview(row: RawOverview, clinicId: string): ClinicBillingOverview {
  assertOwnClinic(clinicId, row.clinic_id);
  const next = row.next_charge;
  const situation = row.financial_situation ?? {};
  const summary = situation.summary_code;
  const overdueCents =
    typeof situation.overdue_cents === "number" && situation.overdue_cents > 0
      ? situation.overdue_cents
      : null;
  const latest = row.latest_payment_display_state;
  return {
    clinicId: row.clinic_id ?? clinicId,
    plan: mapPlan(row.plan),
    pixAuthorizationStatus: (row.pix_authorization_status as PixAuthorizationStatus | null) ?? null,
    pixGeneration: typeof row.pix_generation === "number" ? row.pix_generation : null,
    identityComplete: row.identity_complete === true,
    nextCharge:
      next &&
      typeof next.amount_cents === "number" &&
      typeof next.due_date === "string" &&
      next.due_date &&
      next.display_state &&
      isChargeDisplayState(next.display_state)
        ? {
            amountCents: next.amount_cents,
            currency: next.currency === "BRL" ? "BRL" : "BRL",
            dueDate: next.due_date,
            displayState: next.display_state,
          }
        : null,
    financialSituation: {
      summaryCode: (
        ["no_plan", "no_charges", "current", "pending", "overdue"] as FinancialSummaryCode[]
      ).includes(summary as FinancialSummaryCode)
        ? (summary as FinancialSummaryCode)
        : "no_charges",
      attention: situation.attention === true,
      overdueCount: typeof situation.overdue_count === "number" ? situation.overdue_count : 0,
      overdueCents,
    },
    latestPaymentDisplayState: latest && isPaymentDisplayState(latest) ? latest : null,
    chargeCount: typeof row.charge_count === "number" ? row.charge_count : 0,
    entitlementEnforcement: "OFF",
    entitlementGranted: false,
  };
}

function mapCharge(row: RawCharge): ClinicBillingCharge | null {
  if (!row.id || typeof row.amount_cents !== "number" || !row.display_state) return null;
  if (!isChargeDisplayState(row.display_state)) return null;
  return {
    id: row.id,
    amountCents: row.amount_cents,
    currency: row.currency === "BRL" ? "BRL" : "BRL",
    dueDate: row.due_date ?? null,
    paidDate: row.paid_date ?? null,
    displayState: row.display_state,
    method: mapMethod(row.method),
  };
}

function mapPayment(row: RawPayment): ClinicBillingPayment | null {
  if (!row.id || typeof row.amount_cents !== "number" || !row.display_state) return null;
  if (!isPaymentDisplayState(row.display_state)) return null;
  return {
    id: row.id,
    amountCents: row.amount_cents,
    currency: row.currency === "BRL" ? "BRL" : "BRL",
    dueDate: row.due_date ?? null,
    receivedDate: row.received_date ?? null,
    displayState: row.display_state,
    method: mapMethod(row.method),
  };
}

function mapEvent(row: RawEvent): ClinicBillingTimelineEvent | null {
  if (!row.id || !row.occurred_at || !row.type || !isTimelineEventType(row.type)) return null;
  const environment =
    row.environment && isBillingProviderEnvironment(row.environment) ? row.environment : null;
  return { id: row.id, occurredAt: row.occurred_at, type: row.type, environment };
}

export async function getMyClinicBillingOverview(clinicId: string): Promise<ClinicBillingOverview> {
  const { data, error } = await supabase.rpc("get_my_clinic_billing_overview", {
    p_clinic_id: clinicId,
  });
  if (error) throw error;
  if (!data) return emptyBillingOverview(clinicId);
  return mapOverview(data as RawOverview, clinicId);
}

export async function listMyClinicBillingCharges(clinicId: string): Promise<ClinicBillingCharge[]> {
  const { data, error } = await supabase.rpc("list_my_clinic_billing_charges", {
    p_clinic_id: clinicId,
  });
  if (error) throw error;
  const raw = (data ?? {}) as RawList<RawCharge>;
  assertOwnClinic(clinicId, raw.clinic_id);
  return (raw.items ?? []).map(mapCharge).filter((row): row is ClinicBillingCharge => row !== null);
}

export async function listMyClinicBillingPayments(clinicId: string): Promise<ClinicBillingPayment[]> {
  const { data, error } = await supabase.rpc("list_my_clinic_billing_payments", {
    p_clinic_id: clinicId,
  });
  if (error) throw error;
  const raw = (data ?? {}) as RawList<RawPayment>;
  assertOwnClinic(clinicId, raw.clinic_id);
  return (raw.items ?? []).map(mapPayment).filter((row): row is ClinicBillingPayment => row !== null);
}

export async function listMyClinicBillingTimeline(
  clinicId: string,
): Promise<ClinicBillingTimelineEvent[]> {
  const { data, error } = await supabase.rpc("list_my_clinic_billing_timeline", {
    p_clinic_id: clinicId,
  });
  if (error) throw error;
  const raw = (data ?? {}) as RawList<RawEvent>;
  assertOwnClinic(clinicId, raw.clinic_id);
  return (raw.items ?? [])
    .map(mapEvent)
    .filter((row): row is ClinicBillingTimelineEvent => row !== null);
}
