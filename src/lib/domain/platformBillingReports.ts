import {
  formatPlatformDate,
  formatPlatformMoney,
  platformBillingErrorMessage,
  type PlatformAgingBucket,
} from "./platformBilling";
import { BILLING_CSV_MAX_EXPORT_ROWS, buildCsv, type CsvCell } from "./billingCsv";

export const REPORT_TIMEZONE = "America/Sao_Paulo";
export const REPORT_MAX_PERIOD_DAYS = 366;
export const REPORT_EXPORT_KINDS = ["payments", "delinquent", "received_by_plan"] as const;
export type PlatformBillingReportKind = (typeof REPORT_EXPORT_KINDS)[number];

export interface PlatformBillingReportPeriod {
  start: string;
  end: string;
}

export interface PlatformBillingPlanRow {
  planCode: string | null;
  planDisplayName: string | null;
  planAttribution: "contract" | "unattributed";
  receivedCents: number;
  paymentCount: number;
}

export interface PlatformBillingStatusRow {
  status: string;
  paymentCount: number;
  amountCents: number;
}

export interface PlatformBillingDelinquentRow {
  clinicId: string;
  clinicName: string;
  overdueCount: number;
  overdueCents: number;
  agingBucket: PlatformAgingBucket | null;
  pixStatus: string | null;
}

export interface PlatformBillingReport {
  timezone: typeof REPORT_TIMEZONE;
  periodStart: string;
  periodEnd: string;
  asOf: string;
  notMrr: true;
  entitlementEnforcement: "OFF";
  receivedInPeriodCents: number;
  receivedInPeriodCount: number;
  pendingInPeriodCents: number;
  pendingInPeriodCount: number;
  overdueInPeriodCents: number;
  overdueInPeriodCount: number;
  receivedByPlan: PlatformBillingPlanRow[];
  paymentsByStatus: PlatformBillingStatusRow[];
  activePixAutomaticAuthorizations: number;
  delinquentClinics: number;
  delinquentItems: PlatformBillingDelinquentRow[];
  exportMaxRows: number;
}

export interface PlatformBillingExportRow {
  rowKind: string;
  clinicName?: string | null;
  planCode?: string | null;
  planDisplayName?: string | null;
  planAttribution?: string | null;
  amountCents?: number | null;
  receivedCents?: number | null;
  overdueCents?: number | null;
  overdueCount?: number | null;
  paymentCount?: number | null;
  currency?: string | null;
  financialState?: string | null;
  dueDate?: string | null;
  paymentDate?: string | null;
  method?: string | null;
  agingBucket?: string | null;
  pixStatus?: string | null;
}

export interface PlatformBillingExportPage {
  timezone: typeof REPORT_TIMEZONE;
  periodStart: string;
  periodEnd: string;
  kind: PlatformBillingReportKind;
  limit: number;
  offset: number;
  maxLimit: number;
  items: PlatformBillingExportRow[];
}

export function currentSaoPauloMonth(now = new Date()): PlatformBillingReportPeriod {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export function validateReportPeriod(start: string, end: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return "Informe o início e o fim no calendário civil de America/Sao_Paulo.";
  }
  if (start > end) {
    return "A data inicial não pode ser posterior à data final.";
  }
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const days = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
  if (days > REPORT_MAX_PERIOD_DAYS) {
    return `O recorte máximo é ${REPORT_MAX_PERIOD_DAYS} dias.`;
  }
  return null;
}

export function emptyPlatformBillingReport(
  period: PlatformBillingReportPeriod = currentSaoPauloMonth(),
): PlatformBillingReport {
  return {
    timezone: REPORT_TIMEZONE,
    periodStart: period.start,
    periodEnd: period.end,
    asOf: period.end,
    notMrr: true,
    entitlementEnforcement: "OFF",
    receivedInPeriodCents: 0,
    receivedInPeriodCount: 0,
    pendingInPeriodCents: 0,
    pendingInPeriodCount: 0,
    overdueInPeriodCents: 0,
    overdueInPeriodCount: 0,
    receivedByPlan: [],
    paymentsByStatus: [],
    activePixAutomaticAuthorizations: 0,
    delinquentClinics: 0,
    delinquentItems: [],
    exportMaxRows: BILLING_CSV_MAX_EXPORT_ROWS,
  };
}

export function platformReportErrorMessage(error: unknown): string {
  const hint =
    error && typeof error === "object" && "hint" in error
      ? String((error as { hint?: unknown }).hint ?? "")
      : "";
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  const code = `${hint} ${message}`;
  if (code.includes("BILLING_REPORT_PERIOD_INVALID")) {
    return "Informe um recorte civil válido em America/Sao_Paulo.";
  }
  if (code.includes("BILLING_REPORT_PERIOD_TOO_LONG")) {
    return `O recorte máximo é ${REPORT_MAX_PERIOD_DAYS} dias.`;
  }
  if (code.includes("BILLING_REPORT_KIND_INVALID")) {
    return "Este recorte de exportação não é suportado.";
  }
  return platformBillingErrorMessage(error);
}

export function paymentStatusLabel(status: string): string {
  if (status === "received") return "Recebido";
  if (status === "pending") return "Em aberto";
  if (status === "overdue") return "Vencido";
  if (status === "authorized") return "Autorizado";
  if (status === "confirmed") return "Confirmado";
  return status;
}

export function planAttributionLabel(value: string | null | undefined): string {
  return value === "contract" ? "Contrato da cobrança" : "Sem atribuição histórica";
}

export function reportExportHeaders(kind: PlatformBillingReportKind): string[] {
  if (kind === "delinquent") {
    return ["clinica", "plano", "cobrancas_vencidas", "valor_vencido_centavos", "envelhecimento", "pix"];
  }
  if (kind === "received_by_plan") {
    return ["plano", "nome_do_plano", "atribuicao", "recebido_centavos", "pagamentos"];
  }
  return [
    "clinica",
    "plano",
    "atribuicao",
    "valor_centavos",
    "moeda",
    "situacao",
    "vencimento",
    "recebimento",
    "metodo",
  ];
}

export function reportExportCells(
  kind: PlatformBillingReportKind,
  row: PlatformBillingExportRow,
): CsvCell[] {
  if (kind === "delinquent") {
    return [
      row.clinicName ?? "",
      row.planCode ?? "",
      row.overdueCount ?? 0,
      row.overdueCents ?? 0,
      row.agingBucket ?? "",
      row.pixStatus ?? "",
    ];
  }
  if (kind === "received_by_plan") {
    return [
      row.planCode ?? "",
      row.planDisplayName ?? "",
      row.planAttribution ?? "unattributed",
      row.receivedCents ?? 0,
      row.paymentCount ?? 0,
    ];
  }
  return [
    row.clinicName ?? "",
    row.planCode ?? "",
    row.planAttribution ?? "unattributed",
    row.amountCents ?? 0,
    row.currency ?? "BRL",
    row.financialState ?? "",
    row.dueDate ?? "",
    row.paymentDate ?? "",
    row.method ?? "",
  ];
}

export function buildBillingReportCsv(
  kind: PlatformBillingReportKind,
  page: PlatformBillingExportPage,
): string {
  return buildCsv(
    reportExportHeaders(kind),
    page.items.map((row) => reportExportCells(kind, row)),
  );
}

export function reportMoney(cents: number): string {
  return formatPlatformMoney(cents);
}

export function reportDate(value: string | null | undefined): string {
  return formatPlatformDate(value);
}
