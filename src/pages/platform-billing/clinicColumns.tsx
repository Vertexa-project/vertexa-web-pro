import { StatusChip } from "@/components/platform-billing/StatusChip";
import type { Column } from "@/components/data-table/DataTable";
import {
  attentionReasonLabel,
  clinicPlanCopy,
  contractStatusLabel,
  financialSummaryLabel,
  financialSummaryTone,
  formatPlatformDate,
  formatPlatformMoney,
  nextChargeCopy,
  pixAutomaticStatusLabel,
  type PlatformBillingClinicRow,
} from "@/lib/domain/platformBilling";

export function clinicHref(row: PlatformBillingClinicRow): string {
  return `/platform/billing/clinicas/${row.clinicId}`;
}

export function clinicColumns(): Column<PlatformBillingClinicRow>[] {
  return [
    {
      key: "clinic",
      header: "Clínica",
      render: (row) => (
        <div>
          <div className="font-medium text-foreground">{row.clinicName}</div>
          <div className="text-xs text-muted-foreground">
            {row.attention ? attentionReasonLabel(row.attentionReason) : "Sem atenção"}
          </div>
        </div>
      ),
    },
    {
      key: "plan",
      header: "Contrato",
      render: (row) => (
        <div>
          <div>{clinicPlanCopy(row)}</div>
          <div className="text-xs text-muted-foreground">{contractStatusLabel(row.contractStatus)}</div>
        </div>
      ),
    },
    {
      key: "pix",
      header: "Pix Automático",
      render: (row) => pixAutomaticStatusLabel(row.pixStatus),
    },
    {
      key: "financial",
      header: "Situação financeira",
      render: (row) => (
        <StatusChip
          label={financialSummaryLabel(row.financialSummary)}
          tone={financialSummaryTone(row.financialSummary)}
        />
      ),
    },
    {
      key: "overdue",
      header: "Vencido",
      render: (row) =>
        row.overdueCount > 0
          ? `${row.overdueCount} · ${formatPlatformMoney(row.overdueCents)}`
          : "—",
    },
    {
      key: "next",
      header: "Próxima cobrança",
      render: (row) => nextChargeCopy(row.nextCharge),
    },
    {
      key: "since",
      header: "Início",
      render: (row) => formatPlatformDate(row.contractEffectiveFrom),
    },
  ];
}

export function clinicMobile(row: PlatformBillingClinicRow) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{row.clinicName}</p>
          <p className="text-sm text-muted-foreground">{clinicPlanCopy(row)}</p>
        </div>
        <StatusChip
          label={financialSummaryLabel(row.financialSummary)}
          tone={financialSummaryTone(row.financialSummary)}
        />
      </div>
      <p className="text-sm">
        Pix: {pixAutomaticStatusLabel(row.pixStatus)} ·{" "}
        {row.attention ? attentionReasonLabel(row.attentionReason) : "Sem atenção"}
      </p>
      {row.overdueCount > 0 ? (
        <p className="text-sm text-destructive">
          Vencido: {row.overdueCount} · {formatPlatformMoney(row.overdueCents)}
        </p>
      ) : null}
    </div>
  );
}
