import { StatusChip } from "@/components/platform-billing/StatusChip";
import type { Column } from "@/components/data-table/DataTable";
import {
  attentionReasonLabel,
  clinicPlanCopy,
  contractStatusLabel,
  financialSummaryLabel,
  financialSummaryTone,
  formatPlatformDate,
  nextChargeCopy,
  pixAutomaticStatusLabel,
  providerLatestPaymentCopy,
  providerOverdueCopy,
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
      render: (row) => (
        <div className="text-sm">
          <div>Sandbox: {pixAutomaticStatusLabel(row.provider.sandbox.pixStatus)}</div>
          <div className="text-xs text-muted-foreground">
            Produção: {pixAutomaticStatusLabel(row.provider.production.pixStatus)}
          </div>
        </div>
      ),
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
      render: (row) => (
        <div className="text-sm">
          <div>Sandbox: {providerOverdueCopy(row.provider.sandbox)}</div>
          <div className="text-xs text-muted-foreground">
            Produção: {providerOverdueCopy(row.provider.production)}
          </div>
        </div>
      ),
    },
    {
      key: "latest",
      header: "Último pagamento",
      render: (row) => (
        <div className="text-sm">
          <div>Sandbox: {providerLatestPaymentCopy(row.provider.sandbox)}</div>
          <div className="text-xs text-muted-foreground">
            Produção: {providerLatestPaymentCopy(row.provider.production)}
          </div>
        </div>
      ),
    },
    {
      key: "next",
      header: "Próxima cobrança",
      render: (row) => (
        <div className="text-sm">
          <div>Sandbox: {nextChargeCopy(row.provider.sandbox.nextCharge)}</div>
          <div className="text-xs text-muted-foreground">
            Produção: {nextChargeCopy(row.provider.production.nextCharge)}
          </div>
        </div>
      ),
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
        Pix Sandbox: {pixAutomaticStatusLabel(row.provider.sandbox.pixStatus)} · Pix Produção:{" "}
        {pixAutomaticStatusLabel(row.provider.production.pixStatus)} ·{" "}
        {row.attention ? attentionReasonLabel(row.attentionReason) : "Sem atenção"}
      </p>
      {row.provider.sandbox.overdueCount > 0 || row.provider.production.overdueCount > 0 ? (
        <p className="text-sm text-destructive">
          Vencido Sandbox: {providerOverdueCopy(row.provider.sandbox)} · Produção:{" "}
          {providerOverdueCopy(row.provider.production)}
        </p>
      ) : null}
    </div>
  );
}
