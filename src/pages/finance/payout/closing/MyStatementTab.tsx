// Financeiro › Repasse › Meu extrato (Entrega 6): o profissional vê só os próprios extratos fechados, aceita ou contesta, envia a NF e baixa o PDF.
import { useState } from "react";
import { FileDown } from "lucide-react";

import { FinTable } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFinContext } from "@/hooks/useFin";
import { useMyStatements } from "@/hooks/useFinClosing";
import type { MyStatementRow } from "@/lib/api/finClosing";
import { canSeeMyStatement } from "@/lib/domain/finAccess";
import { NF_LABEL, STATEMENT_STATUS_LABEL, acceptanceText, acceptanceTone, brDate, nfTone, periodLabel } from "@/lib/domain/finClosing";
import { formatBRL } from "@/lib/domain/finance";
import { NoAccess } from "@/pages/finance/NoAccess";
import { StatementDialog } from "@/pages/finance/payout/closing/StatementDialog";

export function MyStatementTab() {
  const { clinicId, access } = useFinContext();
  const [open, setOpen] = useState<string | null>(null);
  const can = canSeeMyStatement(access);
  const q = useMyStatements(clinicId, can);
  if (!clinicId) return <LoadingState />;
  if (!can) return <NoAccess />;
  const rows = q.data ?? [];
  return (
    <div className="min-w-0 space-y-4">
      <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm" role="note">Aqui ficam os seus extratos fechados. Confira, aceite ou conteste dentro do prazo; depois do pagamento, o comprovante aparece no extrato.</p>
      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={FileDown} title="Nenhum extrato fechado ainda" description="Quando a clínica iniciar o fechamento do mês, o seu extrato aparece aqui para o aceite." />
      ) : (
        <FinTable<MyStatementRow>
          label="Meus extratos" rows={rows} rowKey={(r) => r.id}
          columns={[
            { header: "Mês", role: "title", cell: (r) => periodLabel(r.period) },
            { header: "Situação", role: "badge", cell: (r) => <Badge tone={r.status === "paid" ? "success" : r.status === "approved" ? "info" : "warning"}>{STATEMENT_STATUS_LABEL[r.status]}</Badge> },
            { header: "Aceite", role: "badge", cell: (r) => <Badge tone={acceptanceTone(r.acceptance)} className="whitespace-normal text-center">{acceptanceText(r)}</Badge> },
            { header: "Total bruto", nowrap: true, className: "tabular-nums", cell: (r) => formatBRL(r.gross_cents) },
            { header: "Retenções", nowrap: true, className: "tabular-nums", cell: (r) => (r.withholding_cents === 0 ? formatBRL(0) : `−${formatBRL(r.withholding_cents)}`) },
            { header: "Líquido", nowrap: true, className: "tabular-nums font-semibold", cell: (r) => formatBRL(r.net_cents) },
            { header: "NF", cell: (r) => (r.requires_invoice ? <Badge tone={nfTone(r.nf_status)}>{NF_LABEL[r.nf_status]}</Badge> : "Não exigida") },
            { header: "Pago em", nowrap: true, cell: (r) => brDate(r.paid_on) },
            { header: "Ações", role: "action", cell: (r) => <Button size="sm" variant="outline" onClick={() => setOpen(r.id)} aria-label={`Abrir extrato de ${periodLabel(r.period)}`}>Abrir extrato</Button> },
          ]}
        />
      )}
      {open ? <StatementDialog statementId={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
