import { supabase } from "@/lib/supabase";
import {
  isAgingBucket,
  isAttentionReason,
  isBillingMethod,
  isChargeDisplayState,
  isFinancialSummary,
  isPaymentDisplayState,
  isTimelineEventType,
  PLATFORM_BILLING_PAGE_SIZE,
  type PlatformBillingCharge,
  type PlatformBillingClinicFilters,
  type PlatformBillingClinicRow,
  type PlatformBillingEvent,
  type PlatformBillingListFilters,
  type PlatformBillingNextCharge,
  type PlatformBillingOverview,
  type PlatformBillingPage,
  type PlatformBillingPayment,
  type PlatformClinicBillingDetail,
  type PlatformEventEntityType,
  type PlatformFinancialSummary,
} from "@/lib/domain/platformBilling";
import { isBillingProviderEnvironment, type ClinicBillingTimelineEvent } from "@/lib/domain/billingHub";

interface RawNextCharge {
  amount_cents?: number;
  due_date?: string;
  display_state?: string;
}

interface RawClinic {
  clinic_id?: string;
  clinic_name?: string;
  plan_code?: string | null;
  plan_display_name?: string | null;
  plan_price_cents?: number | null;
  plan_currency?: string | null;
  billing_cycle?: string | null;
  contract_status?: string | null;
  contract_effective_from?: string | null;
  identity_complete?: boolean;
  customer_bound?: boolean;
  pix_status?: string | null;
  pix_generation?: number | null;
  financial_summary?: string;
  overdue_count?: number;
  overdue_cents?: number | null;
  pending_cents?: number | null;
  charge_count?: number;
  next_charge?: RawNextCharge | null;
  latest_payment_state?: string | null;
  latest_payment_date?: string | null;
  aging_bucket?: string | null;
  attention?: boolean;
  attention_reason?: string;
  entitlement_enforcement?: string;
  entitlement_granted?: boolean;
}

interface RawAging {
  clinic_count?: number;
  amount_cents?: number;
}

interface RawBucket {
  received_in_period_cents?: number;
  received_in_period_count?: number;
  pending_in_period_cents?: number;
  pending_in_period_count?: number;
  overdue_in_period_cents?: number;
  overdue_in_period_count?: number;
}

interface RawOverview {
  timezone?: string;
  period_start?: string;
  period_end?: string;
  financial?: {
    sandbox?: RawBucket;
    production?: RawBucket;
  };
  clinics_with_received?: number;
  delinquent_clinics?: number;
  active_commercial_contracts?: number;
  active_pix_automatic_authorizations?: number;
  payment_success_count?: number;
  attention_clinic_count?: number;
  aging?: Partial<Record<string, RawAging>>;
  entitlement_enforcement?: string;
}

interface RawCharge {
  id?: string;
  clinic_id?: string;
  clinic_name?: string;
  environment?: string | null;
  amount_cents?: number;
  currency?: string;
  due_date?: string | null;
  paid_date?: string | null;
  display_state?: string;
  method?: string;
}

interface RawPayment {
  id?: string;
  clinic_id?: string;
  clinic_name?: string;
  environment?: string | null;
  amount_cents?: number;
  currency?: string;
  due_date?: string | null;
  received_date?: string | null;
  display_state?: string;
  method?: string;
}

interface RawEvent {
  id?: string;
  event_type?: string;
  processing_status?: string;
  received_at?: string;
  processed_at?: string | null;
  failure_category?: string | null;
  clinic_id?: string | null;
  clinic_name?: string | null;
  related_payment_id?: string | null;
  related_entity_type?: string;
}

interface RawTimeline {
  id?: string;
  occurred_at?: string;
  type?: string;
  environment?: string | null;
}

interface RawPage<T> {
  limit?: number;
  offset?: number;
  items?: T[];
}

interface RawDetail {
  found?: boolean;
  clinic_id?: string;
  clinic?: RawClinic | null;
  charges?: RawCharge[];
  payments?: RawPayment[];
  business_timeline?: RawTimeline[];
  events?: RawEvent[];
}

function asInt(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function mapNextCharge(raw: RawNextCharge | null | undefined): PlatformBillingNextCharge | null {
  if (
    !raw ||
    typeof raw.amount_cents !== "number" ||
    !raw.due_date ||
    !raw.display_state ||
    !isChargeDisplayState(raw.display_state)
  ) {
    return null;
  }
  return {
    amountCents: raw.amount_cents,
    dueDate: raw.due_date,
    displayState: raw.display_state,
  };
}

export function mapPlatformClinicRow(row: RawClinic): PlatformBillingClinicRow | null {
  if (!row.clinic_id || !row.clinic_name) return null;
  const summary = row.financial_summary;
  const attentionReason = row.attention_reason ?? "";
  return {
    clinicId: row.clinic_id,
    clinicName: row.clinic_name,
    planCode: row.plan_code ?? null,
    planDisplayName: row.plan_display_name ?? null,
    planPriceCents: typeof row.plan_price_cents === "number" ? row.plan_price_cents : null,
    planCurrency: row.plan_currency === "BRL" ? "BRL" : "BRL",
    billingCycle: row.billing_cycle ?? null,
    contractStatus: row.contract_status ?? null,
    contractEffectiveFrom: row.contract_effective_from ?? null,
    identityComplete: row.identity_complete === true,
    customerBound: row.customer_bound === true,
    pixStatus: row.pix_status ?? null,
    pixGeneration: typeof row.pix_generation === "number" ? row.pix_generation : null,
    financialSummary: isFinancialSummary(summary ?? "")
      ? (summary as PlatformFinancialSummary)
      : "no_charges",
    overdueCount: asInt(row.overdue_count),
    overdueCents: typeof row.overdue_cents === "number" && row.overdue_cents > 0 ? row.overdue_cents : null,
    pendingCents: typeof row.pending_cents === "number" && row.pending_cents > 0 ? row.pending_cents : null,
    chargeCount: asInt(row.charge_count),
    nextCharge: mapNextCharge(row.next_charge),
    latestPaymentState:
      row.latest_payment_state && isPaymentDisplayState(row.latest_payment_state)
        ? row.latest_payment_state
        : null,
    latestPaymentDate: row.latest_payment_date ?? null,
    agingBucket: row.aging_bucket && isAgingBucket(row.aging_bucket) ? row.aging_bucket : null,
    attention: row.attention === true,
    attentionReason: isAttentionReason(attentionReason) ? attentionReason : "none",
    entitlementEnforcement: "OFF",
    entitlementGranted: false,
  };
}

function mapAging(raw: RawAging | undefined) {
  return {
    clinicCount: asInt(raw?.clinic_count),
    amountCents: asInt(raw?.amount_cents),
  };
}

export function mapPlatformOverview(row: RawOverview): PlatformBillingOverview {
  return {
    timezone: "America/Sao_Paulo",
    periodStart: row.period_start ?? "",
    periodEnd: row.period_end ?? "",
    financial: {
      sandbox: {
        receivedCents: asInt(row.financial?.sandbox?.received_in_period_cents),
        receivedCount: asInt(row.financial?.sandbox?.received_in_period_count),
        pendingCents: asInt(row.financial?.sandbox?.pending_in_period_cents),
        pendingCount: asInt(row.financial?.sandbox?.pending_in_period_count),
        overdueCents: asInt(row.financial?.sandbox?.overdue_in_period_cents),
        overdueCount: asInt(row.financial?.sandbox?.overdue_in_period_count),
      },
      production: {
        receivedCents: asInt(row.financial?.production?.received_in_period_cents),
        receivedCount: asInt(row.financial?.production?.received_in_period_count),
        pendingCents: asInt(row.financial?.production?.pending_in_period_cents),
        pendingCount: asInt(row.financial?.production?.pending_in_period_count),
        overdueCents: asInt(row.financial?.production?.overdue_in_period_cents),
        overdueCount: asInt(row.financial?.production?.overdue_in_period_count),
      },
    },
    clinicsWithReceived: asInt(row.clinics_with_received),
    delinquentClinics: asInt(row.delinquent_clinics),
    activeCommercialContracts: asInt(row.active_commercial_contracts),
    activePixAutomaticAuthorizations: asInt(row.active_pix_automatic_authorizations),
    paymentSuccessCount: asInt(row.payment_success_count),
    attentionClinicCount: asInt(row.attention_clinic_count),
    aging: {
      d1_7: mapAging(row.aging?.d1_7),
      d8_15: mapAging(row.aging?.d8_15),
      d16_30: mapAging(row.aging?.d16_30),
      d31_plus: mapAging(row.aging?.d31_plus),
    },
    entitlementEnforcement: "OFF",
  };
}

function mapCharge(row: RawCharge): PlatformBillingCharge | null {
  if (!row.id || !row.clinic_id || typeof row.amount_cents !== "number" || !row.display_state) {
    return null;
  }
  if (!isChargeDisplayState(row.display_state)) return null;
  return {
    id: row.id,
    clinicId: row.clinic_id,
    clinicName: row.clinic_name,
    amountCents: row.amount_cents,
    currency: row.currency === "BRL" ? "BRL" : "BRL",
    dueDate: row.due_date ?? null,
    paidDate: row.paid_date ?? null,
    displayState: row.display_state,
    method: row.method && isBillingMethod(row.method) ? row.method : "UNDEFINED",
    environment: row.environment && isBillingProviderEnvironment(row.environment) ? row.environment : null,
  };
}

function mapPayment(row: RawPayment): PlatformBillingPayment | null {
  if (!row.id || !row.clinic_id || typeof row.amount_cents !== "number" || !row.display_state) {
    return null;
  }
  if (!isPaymentDisplayState(row.display_state)) return null;
  return {
    id: row.id,
    clinicId: row.clinic_id,
    clinicName: row.clinic_name,
    amountCents: row.amount_cents,
    currency: row.currency === "BRL" ? "BRL" : "BRL",
    dueDate: row.due_date ?? null,
    receivedDate: row.received_date ?? null,
    displayState: row.display_state,
    method: row.method && isBillingMethod(row.method) ? row.method : "UNDEFINED",
    environment: row.environment && isBillingProviderEnvironment(row.environment) ? row.environment : null,
  };
}

function mapEvent(row: RawEvent): PlatformBillingEvent | null {
  if (!row.id || !row.event_type || !row.processing_status || !row.received_at) return null;
  const entity = (["payment", "authorization", "unknown"] as PlatformEventEntityType[]).includes(
    row.related_entity_type as PlatformEventEntityType,
  )
    ? (row.related_entity_type as PlatformEventEntityType)
    : "unknown";
  return {
    id: row.id,
    eventType: row.event_type,
    processingStatus: row.processing_status,
    receivedAt: row.received_at,
    processedAt: row.processed_at ?? null,
    failureCategory: row.failure_category ?? null,
    clinicId: row.clinic_id ?? null,
    clinicName: row.clinic_name ?? null,
    relatedPaymentId: row.related_payment_id ?? null,
    relatedEntityType: entity,
  };
}

function mapTimeline(row: RawTimeline): ClinicBillingTimelineEvent | null {
  if (!row.id || !row.occurred_at || !row.type || !isTimelineEventType(row.type)) return null;
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    type: row.type,
    environment: row.environment && isBillingProviderEnvironment(row.environment) ? row.environment : null,
  };
}

function mapPage<TRaw, T>(
  raw: RawPage<TRaw> | null | undefined,
  mapItem: (row: TRaw) => T | null,
): PlatformBillingPage<T> {
  return {
    limit: asInt(raw?.limit, PLATFORM_BILLING_PAGE_SIZE),
    offset: asInt(raw?.offset),
    items: (raw?.items ?? []).map(mapItem).filter((row): row is T => row !== null),
  };
}

export async function getPlatformBillingOverview(): Promise<PlatformBillingOverview> {
  const { data, error } = await supabase.rpc("get_platform_billing_overview");
  if (error) throw error;
  return mapPlatformOverview((data ?? {}) as RawOverview);
}

export async function listPlatformBillingClinics(
  filters: PlatformBillingClinicFilters = {},
): Promise<PlatformBillingPage<PlatformBillingClinicRow>> {
  const { data, error } = await supabase.rpc("list_platform_billing_clinics", {
    p_clinic_query: filters.clinicQuery || null,
    p_plan_code: filters.planCode || null,
    p_contract_status: filters.contractStatus || null,
    p_pix_status: filters.pixStatus || null,
    p_financial_status: filters.financialStatus || null,
    p_needs_attention: filters.needsAttention ?? null,
    p_limit: filters.limit ?? PLATFORM_BILLING_PAGE_SIZE,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw error;
  return mapPage(data as RawPage<RawClinic>, mapPlatformClinicRow);
}

export async function getPlatformClinicBillingDetail(
  clinicId: string,
): Promise<PlatformClinicBillingDetail> {
  const { data, error } = await supabase.rpc("get_platform_clinic_billing_detail", {
    p_clinic_id: clinicId,
  });
  if (error) throw error;
  const raw = (data ?? {}) as RawDetail;
  const clinic = raw.clinic ? mapPlatformClinicRow(raw.clinic) : null;
  return {
    found: raw.found === true,
    clinicId: clinic?.clinicId ?? clinicId,
    clinic,
    charges: (raw.charges ?? []).map(mapCharge).filter((row): row is PlatformBillingCharge => row !== null),
    payments: (raw.payments ?? [])
      .map(mapPayment)
      .filter((row): row is PlatformBillingPayment => row !== null),
    businessTimeline: (raw.business_timeline ?? [])
      .map(mapTimeline)
      .filter((row): row is ClinicBillingTimelineEvent => row !== null),
    events: (raw.events ?? []).map(mapEvent).filter((row): row is PlatformBillingEvent => row !== null),
  };
}

export async function listPlatformBillingCharges(
  filters: PlatformBillingListFilters = {},
): Promise<PlatformBillingPage<PlatformBillingCharge>> {
  const { data, error } = await supabase.rpc("list_platform_billing_charges", {
    p_clinic_id: filters.clinicId || null,
    p_display_state: filters.displayState || null,
    p_method: filters.method || null,
    p_plan_code: filters.planCode || null,
    p_limit: filters.limit ?? PLATFORM_BILLING_PAGE_SIZE,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw error;
  return mapPage(data as RawPage<RawCharge>, mapCharge);
}

export async function listPlatformBillingPayments(
  filters: PlatformBillingListFilters = {},
): Promise<PlatformBillingPage<PlatformBillingPayment>> {
  const { data, error } = await supabase.rpc("list_platform_billing_payments", {
    p_clinic_id: filters.clinicId || null,
    p_display_state: filters.displayState || null,
    p_method: filters.method || null,
    p_limit: filters.limit ?? PLATFORM_BILLING_PAGE_SIZE,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw error;
  return mapPage(data as RawPage<RawPayment>, mapPayment);
}

export async function listPlatformBillingEvents(
  filters: PlatformBillingListFilters = {},
): Promise<PlatformBillingPage<PlatformBillingEvent>> {
  const { data, error } = await supabase.rpc("list_platform_billing_events", {
    p_clinic_id: filters.clinicId || null,
    p_processing_status: filters.processingStatus || null,
    p_limit: filters.limit ?? PLATFORM_BILLING_PAGE_SIZE,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw error;
  return mapPage(data as RawPage<RawEvent>, mapEvent);
}
