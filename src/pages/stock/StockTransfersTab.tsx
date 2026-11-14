// Estoque › Transferências (Entrega 8, escopo-v1 §8.7): enviar (sai da origem, fica em trânsito), receber no destino com conferência e cancelar antes de receber.
import { useState } from "react";
import { ArrowRightLeft, Plus } from "lucide-react";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { ExportButtons, Field, FinTable, NativeSelect } from "@/components/fin/FinUi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFinContext, useUnits } from "@/hooks/useFin";
import { useCancelTransfer, useTransfers } from "@/hooks/useStockE8";
import type { TransferLine, TransferRow } from "@/lib/api/stockE8";
import { canCountStock, canSeeStockE8 } from "@/lib/domain/finAccess";
import { brDate, brDateTime, e8ErrorMessage, moneyOrZero, TRANSFER_STATUS_LABEL } from "@/lib/domain/stockE8";
import { formatQty } from "@/lib/domain/stockMoves";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";
import { ReasonDialog } from "@/pages/finance/appointments/ReasonDialog";
import { ReceiveTransferDialog, SendTransferDialog } from "@/pages/stock/e8/TransferDialogs";
import { StockShell } from "@/pages/stock/StockShell";

const TONE = { in_transit: "warning", received: "success", canceled: "muted" } as const;

function LinesSummary({ lines }: { lines: TransferLine[] }) {
  return (
    <ul className="min-w-0 space-y-0.5 text-sm">
      {lines.map((l) => (
        <li key={l.line_id} className="break-words">
          {l.item_name} · {formatQty(l.qty_received ?? l.qty_sent)}{l.qty_received !== null && l.qty_received !== l.qty_sent ? ` de ${formatQty(l.qty_sent)}` : ""} {l.stock_unit} · lote {l.dest_lot_code ?? l.lot_code}
          {l.loss_qty ? <span className="text-destructive"> · diferença {formatQty(l.loss_qty)} ({moneyOrZero(l.loss_cents)}){l.receive_reason ? ` — ${l.receive_reason}` : ""}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function StockTransfersTab() {
  const { clinicId, access, isLoading } = useFinContext();
  const canRead = canSeeStockE8(access);
  const canWrite = canCountStock(access);
  const units = (useUnits(clinicId, canRead).data ?? []).filter((u) => u.is_active);
  const [unitId, setUnitId] = useState("");
  const [status, setStatus] = useState("");
  const [dialog, setDialog] = useState<"send" | null>(null);
  const [receiving, setReceiving] = useState<TransferRow | null>(null);
  const [canceling, setCanceling] = useState<TransferRow | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const q = useTransfers(clinicId, { unitId: unitId || null, status }, canRead);
  const cancel = useCancelTransfer();
  const rows = q.data ?? [];
  const stale = rows.filter((r) => r.stale).length;
  const columns: ExportColumn<TransferRow>[] = [
    { header: "Nº", value: (r) => r.number }, { header: "Situação", value: (r) => TRANSFER_STATUS_LABEL[r.status] }, { header: "Origem", value: (r) => r.from_unit_name }, { header: "Destino", value: (r) => r.to_unit_name },
    { header: "Enviada em", value: (r) => brDateTime(r.sent_at) }, { header: "Recebida em", value: (r) => brDateTime(r.received_at) }, { header: "Itens", value: (r) => r.lines.map((l) => `${l.item_name} (${formatQty(l.qty_sent)})`).join("; ") },
    { header: "Valor enviado (R$)", value: (r) => r.sent_cents, kind: "money" }, { header: "Valor recebido (R$)", value: (r) => (r.status === "received" ? r.received_cents : null), kind: "money" }, { header: "Diferença (R$)", value: (r) => (r.status === "received" ? r.loss_cents : null), kind: "money" },
  ];

  return (
    <StockShell description="Transfira itens entre unidades: sai da origem, fica em trânsito e entra no destino quando a unidade conferir. Divergência exige motivo e vira perda da origem."
      actions={canRead && canWrite ? <Button onClick={() => setDialog("send")} disabled={units.length < 2}><Plus aria-hidden /> Nova transferência</Button> : undefined}>
      {isLoading || (q.isLoading && canRead) ? <LoadingState /> : !canRead ? <NoAccess text="As transferências são do administrador, do gestor, do estoquista e do financeiro (consulta)." /> : (
        <div className="min-w-0 space-y-4">
          {stale > 0 ? <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" role="alert">{stale} {stale === 1 ? "transferência está parada" : "transferências estão paradas"} em trânsito há mais dias que o combinado. Cobre o recebimento ou cancele.</p> : null}
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Unidade" htmlFor="tr-f-unit"><NativeSelect id="tr-f-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">Todas</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect></Field>
            <Field label="Situação" htmlFor="tr-f-status"><NativeSelect id="tr-f-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option><option value="in_transit">Em trânsito</option><option value="received">Recebidas</option><option value="canceled">Canceladas</option></NativeSelect></Field>
          </div>
          <ExportButtons columns={columns} rows={rows} filename="transferencias" sheetName="Transferências" />
          {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
            <EmptyState icon={ArrowRightLeft} title="Nenhuma transferência" description="Quando uma unidade enviar itens para outra, a transferência aparece aqui." />
          ) : (
            <FinTable<TransferRow>
              label="Transferências" rows={rows} rowKey={(r) => r.id}
              columns={[
                { header: "Transferência", role: "title", cell: (r) => `Nº ${r.number} · ${r.from_unit_name} → ${r.to_unit_name}` },
                { header: "Situação", role: "badge", cell: (r) => <Badge tone={r.stale ? "destructive" : TONE[r.status]}>{r.stale ? `Parada há ${r.age_days} dias` : TRANSFER_STATUS_LABEL[r.status]}</Badge> },
                { header: "Enviada", nowrap: true, cell: (r) => `${brDate(r.sent_at)}${r.sent_by_name ? ` · ${r.sent_by_name}` : ""}` },
                { header: "Valor", nowrap: true, className: "tabular-nums", cell: (r) => (r.status === "received" && r.loss_cents !== 0 ? `${moneyOrZero(r.received_cents)} (dif. ${moneyOrZero(r.loss_cents)})` : moneyOrZero(r.sent_cents)) },
                { header: "Itens", wide: true, cell: (r) => <LinesSummary lines={r.lines} /> },
                { header: "Recebimento / cancelamento", wide: true, cell: (r) => (r.status === "received" ? `${brDateTime(r.received_at)} · ${r.received_by_name ?? ""}${r.receive_note ? ` — ${r.receive_note}` : ""}` : r.status === "canceled" ? `${brDateTime(r.canceled_at)} — ${r.cancel_reason ?? ""}` : "—") },
                { header: "Ações", role: "action", cell: (r) => (canWrite ? (
                  <div className="flex flex-col items-stretch gap-1">
                    {r.can_receive ? <Button size="sm" onClick={() => setReceiving(r)} aria-label={`Receber transferência ${r.number}`}>Receber</Button> : null}
                    {r.can_cancel ? <Button size="sm" variant="ghost" onClick={() => { setCancelError(null); setCanceling(r); }} aria-label={`Cancelar transferência ${r.number}`}>Cancelar</Button> : null}
                  </div>
                ) : null) },
              ]}
            />
          )}
          {dialog === "send" && clinicId ? <SendTransferDialog clinicId={clinicId} units={units} defaultFrom={unitId} onClose={() => setDialog(null)} /> : null}
          {receiving ? <ReceiveTransferDialog transfer={receiving} onClose={() => setReceiving(null)} /> : null}
          {canceling ? (
            <ReasonDialog title={`Cancelar transferência nº ${canceling.number}`} submitLabel="Cancelar transferência" pending={cancel.isPending} error={cancelError}
              description="Tudo volta para a unidade de origem (estorno de cada saída). Só é possível antes do recebimento."
              onClose={() => setCanceling(null)}
              onSubmit={(reason) => { setCancelError(null); cancel.mutate({ transferId: canceling.id, reason }, { onSuccess: () => setCanceling(null), onError: (e) => setCancelError(e8ErrorMessage(e)) }); }} />
          ) : null}
        </div>
      )}
    </StockShell>
  );
}
