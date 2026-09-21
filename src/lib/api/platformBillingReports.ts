import { supabase } from "@/lib/supabase";
import { isAgingBucket } from "@/lib/domain/platformBilling";
import { emptyEnvironmentFinancialBucket } from "@/lib/domain/billingEnvScoping";
import {
  emptyPlatformBillingReport,
  type PlatformBillingDelinquentRow,
  type PlatformBillingExportPage,
  type PlatformBillingExportRow,
  type PlatformBillingPlanRow,
  type PlatformBillingReport,
  type PlatformBillingReportEnvironment,
  type PlatformBillingReportKind,
  type PlatformBillingStatusRow,
} from "@/lib/domain/platformBillingReports";
import { mapPlatformCommercialGovernance } from "./billingCommercial";

interface RawPlan {
  environment?: string | null;
  plan_code?: string | null;
  plan_display_name?: string | null;
  plan_attribution?: string;
  received_cents?: number;
  payment_count?: number;
}

interface RawStatus {
  environment?: string | null;
  status?: string;
  payment_count?: number;
  amount_cents?: number;
}

interface RawDelinquent {
  clinic_id?: string;
  clinic_name?: string;
  environment?: string | null;
  overdue_count?: number;
  overdue_cents?: number;
  aging_bucket?: string | null;
  pix_status?: string | null;
}

interface RawBucket {
  received_in_period_cents?: number;
  received_in_period_count?: number;
  pending_in_period_cents?: number;
  pending_in_period_count?: number;
  overdue_in_period_cents?: number;
  overdue_in_period_count?: number;
}

interface RawReport {
  timezone?: string;
  period_start?: string;
  period_end?: string;
  as_of?: string;
  not_mrr?: boolean;
  entitlement_enforcement?: string;
  financial?: {
    sandbox?: RawBucket;
    production?: RawBucket;
  };
  received_by_plan?: RawPlan[];
  payments_by_status?: RawStatus[];
  active_pix_automatic_authorizations?: { sandbox?: number; production?: number };
  delinquent?: { sandbox?: number; production?: number };
  delinquent_items?: RawDelinquent[];
  export_max_rows?: number;
  commercial?: Record<string, unknown>;
}

interface RawExportItem {
  row_kind?: string;
  environment?: string | null;
  clinic_name?: string | null;
  plan_code?: string | null;
  plan_display_name?: string | null;
  plan_attribution?: string | null;
  amount_cents?: number | null;
  received_cents?: number | null;
  overdue_cents?: number | null;
  overdue_count?: number | null;
  payment_count?: number | null;
  currency?: string | null;
  financial_state?: string | null;
  due_date?: string | null;
  payment_date?: string | null;
  method?: string | null;
  aging_bucket?: string | null;
  pix_status?: string | null;
}

interface RawExport {
  timezone?: string;
  period_start?: string;
  period_end?: string;
  kind?: string;
  limit?: number;
  offset?: number;
  max_limit?: number;
  items?: RawExportItem[];
}

function asInt(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function mapEnvironment(value: string | null | undefined): PlatformBillingReportEnvironment | null {
  return value === "sandbox" || value === "production" ? value : null;
}

function mapBucket(raw: RawBucket | undefined) {
  if (!raw) return emptyEnvironmentFinancialBucket();
  return {
    receivedCents: asInt(raw.received_in_period_cents),
    receivedCount: asInt(raw.received_in_period_count),
    pendingCents: asInt(raw.pending_in_period_cents),
    pendingCount: asInt(raw.pending_in_period_count),
    overdueCents: asInt(raw.overdue_in_period_cents),
    overdueCount: asInt(raw.overdue_in_period_count),
  };
}

function mapPlan(row: RawPlan): PlatformBillingPlanRow {
  return {
    environment: mapEnvironment(row.environment),
    planCode: row.plan_code ?? null,
    planDisplayName: row.plan_display_name ?? null,
    planAttribution: row.plan_attribution === "contract" ? "contract" : "unattributed",
    receivedCents: asInt(row.received_cents),
    paymentCount: asInt(row.payment_count),
  };
}

function mapStatus(row: RawStatus): PlatformBillingStatusRow | null {
  if (!row.status) return null;
  return {
    environment: mapEnvironment(row.environment),
    status: row.status,
    paymentCount: asInt(row.payment_count),
    amountCents: asInt(row.amount_cents),
  };
}

function mapDelinquent(row: RawDelinquent): PlatformBillingDelinquentRow | null {
  if (!row.clinic_id || !row.clinic_name) return null;
  return {
    clinicId: row.clinic_id,
    clinicName: row.clinic_name,
    environment: mapEnvironment(row.environment),
    overdueCount: asInt(row.overdue_count),
    overdueCents: asInt(row.overdue_cents),
    agingBucket: row.aging_bucket && isAgingBucket(row.aging_bucket) ? row.aging_bucket : null,
    pixStatus: row.pix_status ?? null,
  };
}

export function mapPlatformBillingReport(raw: RawReport): PlatformBillingReport {
  const empty = emptyPlatformBillingReport({
    start: raw.period_start ?? "",
    end: raw.period_end ?? "",
  });
  return {
    ...empty,
    periodStart: raw.period_start ?? empty.periodStart,
    periodEnd: raw.period_end ?? empty.periodEnd,
    asOf: raw.as_of ?? raw.period_end ?? empty.asOf,
    financial: {
      sandbox: mapBucket(raw.financial?.sandbox),
      production: mapBucket(raw.financial?.production),
    },
    receivedByPlan: (raw.received_by_plan ?? []).map(mapPlan),
    paymentsByStatus: (raw.payments_by_status ?? [])
      .map(mapStatus)
      .filter((row): row is PlatformBillingStatusRow => row !== null),
    activePixAutomaticAuthorizations: {
      sandbox: asInt(raw.active_pix_automatic_authorizations?.sandbox),
      production: asInt(raw.active_pix_automatic_authorizations?.production),
    },
    delinquent: {
      sandbox: asInt(raw.delinquent?.sandbox),
      production: asInt(raw.delinquent?.production),
    },
    delinquentItems: (raw.delinquent_items ?? [])
      .map(mapDelinquent)
      .filter((row): row is PlatformBillingDelinquentRow => row !== null),
    exportMaxRows: asInt(raw.export_max_rows, 500),
    commercial: mapPlatformCommercialGovernance((raw.commercial ?? {}) as Record<string, unknown>),
  };
}

function mapExportRow(row: RawExportItem): PlatformBillingExportRow {
  return {
    rowKind: row.row_kind ?? "payment",
    environment: mapEnvironment(row.environment) ?? row.environment ?? null,
    clinicName: row.clinic_name ?? null,
    planCode: row.plan_code ?? null,
    planDisplayName: row.plan_display_name ?? null,
    planAttribution: row.plan_attribution ?? null,
    amountCents: row.amount_cents ?? null,
    receivedCents: row.received_cents ?? null,
    overdueCents: row.overdue_cents ?? null,
    overdueCount: row.overdue_count ?? null,
    paymentCount: row.payment_count ?? null,
    currency: row.currency ?? null,
    financialState: row.financial_state ?? null,
    dueDate: row.due_date ?? null,
    paymentDate: row.payment_date ?? null,
    method: row.method ?? null,
    agingBucket: row.aging_bucket ?? null,
    pixStatus: row.pix_status ?? null,
  };
}

export async function getPlatformBillingReport(
  periodStart?: string,
  periodEnd?: string,
): Promise<PlatformBillingReport> {
  const { data, error } = await supabase.rpc("get_platform_billing_report", {
    p_period_start: periodStart || null,
    p_period_end: periodEnd || null,
  });
  if (error) throw error;
  return mapPlatformBillingReport((data ?? {}) as RawReport);
}

export async function listPlatformBillingReportExport(input: {
  periodStart?: string;
  periodEnd?: string;
  kind?: PlatformBillingReportKind;
  environment?: PlatformBillingReportEnvironment | null;
  limit?: number;
  offset?: number;
}): Promise<PlatformBillingExportPage> {
  const { data, error } = await supabase.rpc("list_platform_billing_report_export", {
    p_period_start: input.periodStart || null,
    p_period_end: input.periodEnd || null,
    p_kind: input.kind ?? "payments",
    p_limit: input.limit ?? 200,
    p_offset: input.offset ?? 0,
    p_environment: input.environment ?? null,
  });
  if (error) throw error;
  const raw = (data ?? {}) as RawExport;
  const kind = (
    raw.kind === "delinquent" || raw.kind === "received_by_plan" ? raw.kind : "payments"
  ) as PlatformBillingReportKind;
  return {
    timezone: "America/Sao_Paulo",
    periodStart: raw.period_start ?? "",
    periodEnd: raw.period_end ?? "",
    kind,
    limit: asInt(raw.limit, 200),
    offset: asInt(raw.offset),
    maxLimit: asInt(raw.max_limit, 500),
    items: (raw.items ?? []).map(mapExportRow),
  };
}
