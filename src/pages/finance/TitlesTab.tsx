// Financeiro › Títulos (Entrega 2): previstos, liquidados e estornados, com filtros; liquidar, corrigir (gestor) e estornar (chargeback/recusa).
import { useState } from "react";
import { Landmark } from "lucide-react";

import { CentsInput, ExportButtons, Field, FormDialog, TableShell, Td, Th } from "@/components/fin/FinUi";
import { FilterBar } from "@/components/fin/FinFilters";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinContext, useUnits } from "@/hooks/useFin";
import { useCorrectTitle, useReverseTitle, useSettleTitle, useTitles } from "@/hooks/useFinSales";
import type { TitleListRow } from "@/lib/api/finSales";
import { canSeeReceivables, finCan } from "@/lib/domain/finAccess";
import { formatBRL } from "@/lib/domain/finance";
import { financeSalesErrorMessage, RECEIVABLE_STATUS_LABEL, type ReceivableStatus } from "@/lib/domain/finSales";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";

const br = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
const tone = (s: ReceivableStatus) => (s === "settled" ? "success" : s === "reversed" ? "destructive" : "warning");
const statuses = (Object.keys(RECEIVABLE_STATUS_LABEL) as ReceivableStatus[]).map((value) => ({ value, label: RECEIVABLE_STATUS_LABEL[value] }));

type Action = { kind: "correct" | "reverse"; row: TitleListRow } | null;

function ActionDialog({ action, onClose }: { action: NonNullable<Action>; onClose: () => void }) {
  const correct = useCorrectTitle();
  const reverse = useReverseTitle();
  const r = action.row;
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(r.settled_date ?? "");
  const [net, setNet] = useState<number | null>(r.settled_net_cents ?? r.net_cents);
  const [error, setError] = useState<string | null>(null);
  const isCorrect = action.kind === "correct";
  function submit() {
    if (reason.trim().length < 3) return setError("Informe o motivo (fica no Histórico).");
    const opts = { onSuccess: onClose, onError: (e: unknown) => setError(financeSalesErrorMessage(e)) };
    if (isCorrect) {
      if (!date || net === null) return setError("Informe a data e o valor liquidado.");
      correct.mutate({ id: r.id, date, netCents: net, reason: reason.trim() }, opts);
    } else reverse.mutate({ id: r.id, reason: reason.trim() }, opts);
  }
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={isCorrect ? "Corrigir liquidação" : "Estornar título"}
      description={isCorrect ? "Corrige a data e o valor liquidado. O antes e o depois ficam no Histórico." : "Pagamento recusado ou chargeback: o título fica estornado e o repasse é revisto na fase do repasse."}
      onSubmit={submit} pending={correct.isPending || reverse.isPending} error={error} submitLabel={isCorrect ? "Salvar correção" : "Estornar"}>
      <p className="text-sm text-muted-foreground">{r.patient_name ?? "Paciente"} · parcela {r.installment_no}/{r.installments} · bruto {formatBRL(r.gross_cents)}</p>
      {isCorrect ? (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label="Data liquidada" htmlFor="fix-date"><Input id="fix-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Valor liquidado (R$)" htmlFor="fix-net"><CentsInput id="fix-net" value={net} onChange={setNet} /></Field>
        </div>
      ) : null}
      <Field label="Motivo" htmlFor="fix-reason"><Input id="fix-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus /></Field>
    </FormDialog>
  );
}

export function TitlesTab() {
  const { clinicId, access } = useFinContext();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unitId, setUnitId] = useState("");
  const [status, setStatus] = useState("");
  const [action, setAction] = useState<Action>(null);
  const canRead = canSeeReceivables(access);
  const units = useUnits(clinicId, canRead).data ?? [];
  const q = useTitles(clinicId, { unitId, status: status as ReceivableStatus | "", from, to }, canRead);
  const settle = useSettleTitle();
  if (!clinicId) return <LoadingState />;
  if (!canRead) return <NoAccess text="Os títulos (taxas e valores líquidos) são do Financeiro, do Gestor e do administrador." />;
  const rows = q.data ?? [];
  const canWrite = finCan(access, "receivables", "write");
  const canFix = finCan(access, "receivables_fix", "write");
  const columns: ExportColumn<TitleListRow>[] = [
    { header: "Previsto para", value: (r) => br(r.expected_date) }, { header: "Paciente", value: (r) => r.patient_name }, { header: "Forma", value: (r) => r.acquirer_name }, { header: "Bandeira", value: (r) => r.brand },
    { header: "Parcela", value: (r) => `${r.installment_no}/${r.installments}` }, { header: "Bruto (R$)", value: (r) => r.gross_cents, kind: "money" }, { header: "Taxa (R$)", value: (r) => r.fee_cents, kind: "money" },
    { header: "Líquido (R$)", value: (r) => r.net_cents, kind: "money" }, { header: "Liquidado em", value: (r) => br(r.settled_date) }, { header: "Valor liquidado (R$)", value: (r) => r.settled_net_cents, kind: "money" },
    { header: "NSU", value: (r) => r.nsu }, { header: "Situação", value: (r) => RECEIVABLE_STATUS_LABEL[r.status] },
  ];
  const total = (k: "gross_cents" | "fee_cents" | "net_cents") => rows.filter((r) => r.status !== "reversed").reduce((s, r) => s + r[k], 0);
  return (
    <div className="min-w-0 space-y-4">
      <FilterBar idPrefix="titles" from={from} to={to} onFrom={setFrom} onTo={setTo} units={units} unitId={unitId} onUnit={setUnitId} statuses={statuses} status={status} onStatus={setStatus} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ExportButtons columns={columns} rows={rows} filename="titulos" sheetName="Títulos" />
        {rows.length > 0 ? <p className="text-sm text-muted-foreground">Sem estornados: bruto <strong className="tabular-nums text-foreground">{formatBRL(total("gross_cents"))}</strong> · taxa <strong className="tabular-nums text-foreground">{formatBRL(total("fee_cents"))}</strong> · líquido <strong className="tabular-nums text-foreground">{formatBRL(total("net_cents"))}</strong></p> : null}
      </div>
      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={Landmark} title="Nenhum título neste filtro" description="Os títulos nascem quando um recebimento é lançado numa venda." />
      ) : (
        <TableShell label="Títulos">
          <thead><tr><Th>Previsto</Th><Th>Paciente</Th><Th>Forma</Th><Th>Parcela</Th><Th>Bruto</Th><Th>Taxa</Th><Th>Líquido</Th><Th>Situação</Th><Th>Ações</Th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <Td>{br(r.expected_date)}</Td><Td className="font-medium">{r.patient_name ?? "—"}</Td><Td>{r.acquirer_name}{r.brand ? ` · ${r.brand}` : ""}</Td><Td>{r.installment_no}/{r.installments}</Td>
              <Td className="tabular-nums">{formatBRL(r.gross_cents)}</Td><Td className="tabular-nums">{formatBRL(r.fee_cents)}</Td><Td className="tabular-nums">{formatBRL(r.net_cents)}</Td>
              <Td><Badge tone={tone(r.status)}>{RECEIVABLE_STATUS_LABEL[r.status]}</Badge>{r.status === "settled" ? <span className="ml-1 text-xs text-muted-foreground">{br(r.settled_date)}</span> : null}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {canWrite && r.status === "expected" ? <Button size="sm" variant="outline" disabled={settle.isPending} onClick={() => settle.mutate({ id: r.id })} aria-label={`Liquidar parcela ${r.installment_no} de ${r.patient_name ?? "paciente"}`}>Liquidar</Button> : null}
                  {canFix && r.status === "settled" ? <Button size="sm" variant="outline" onClick={() => setAction({ kind: "correct", row: r })} aria-label={`Corrigir liquidação da parcela ${r.installment_no} de ${r.patient_name ?? "paciente"}`}>Corrigir</Button> : null}
                  {canWrite && r.status !== "reversed" ? <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "reverse", row: r })} aria-label={`Estornar parcela ${r.installment_no} de ${r.patient_name ?? "paciente"}`}>Estornar</Button> : null}
                </div>
              </Td>
            </tr>
          ))}</tbody>
        </TableShell>
      )}
      {action ? <ActionDialog key={action.row.id + action.kind} action={action} onClose={() => setAction(null)} /> : null}
    </div>
  );
}
