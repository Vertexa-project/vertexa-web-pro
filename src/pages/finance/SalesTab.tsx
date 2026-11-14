// Financeiro › Vendas (Entrega 2): lista com filtros, nova venda, detalhe com itens, recebimentos e títulos, cancelamento com motivo.
import { useState } from "react";
import { Receipt, Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { ExportButtons, Field, FinTable, FormDialog } from "@/components/fin/FinUi";
import { FilterBar } from "@/components/fin/FinFilters";
import { NewSaleDialog } from "@/components/fin/NewSaleDialog";
import { PaymentDialog } from "@/components/fin/PaymentDialog";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFinContext, useUnits } from "@/hooks/useFin";
import { useCancelSale, useSale, useSales } from "@/hooks/useFinSales";
import type { SaleRow } from "@/lib/api/finSales";
import { canSeeSales, finCan } from "@/lib/domain/finAccess";
import { formatBRL } from "@/lib/domain/finance";
import { financeSalesErrorMessage, RECEIVABLE_STATUS_LABEL, SALE_STATUS_LABEL, type SaleStatus } from "@/lib/domain/finSales";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";

const tone = (s: SaleStatus) => (s === "paid" ? "success" : s === "partial" ? "warning" : s === "canceled" ? "muted" : "info");
/** Data AAAA-MM-DD ou data-hora (created_at em UTC): sempre no dia de Brasília. */
const br = (iso: string | null) =>
  !iso ? "—" : iso.length > 10 ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : iso.split("-").reverse().join("/");
const statuses = (Object.keys(SALE_STATUS_LABEL) as SaleStatus[]).map((value) => ({ value, label: SALE_STATUS_LABEL[value] }));

function SaleDetail({ clinicId, saleId, onClose }: { clinicId: string; saleId: string; onClose: () => void }) {
  const { access } = useFinContext();
  const q = useSale(saleId);
  const cancel = useCancelSale();
  const [paying, setPaying] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const s = q.data;
  const remaining = s ? s.total_net_cents - s.paid_cents : 0;
  const canPay = finCan(access, "sales", "write") && s && (s.status === "open" || s.status === "partial");
  const canCancel = finCan(access, "sale_cancel", "write") && s && s.status !== "canceled";
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Venda{s ? ` — ${s.patient_name ?? "paciente"}` : ""}</DialogTitle>
          <DialogDescription>{s ? `${s.unit_name} · ${br(s.created_at)} · vendedor: ${s.seller_name ?? "—"}` : "Carregando…"}</DialogDescription>
        </DialogHeader>
        <DialogBody className="min-w-0 space-y-5">
          {q.isLoading ? <LoadingState /> : q.isError || !s ? <ErrorState onRetry={() => void q.refetch()} /> : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge tone={tone(s.status)}>{SALE_STATUS_LABEL[s.status]}</Badge>
                <span>Total <strong className="tabular-nums">{formatBRL(s.total_net_cents)}</strong></span>
                <span>Recebido <strong className="tabular-nums">{formatBRL(s.paid_cents)}</strong></span>
                {s.status !== "canceled" ? <span>Saldo <strong className="tabular-nums">{formatBRL(remaining)}</strong></span> : null}
                {s.discount_cents > 0 ? <span className="text-muted-foreground">Desconto {formatBRL(s.discount_cents)}</span> : null}
              </div>
              {s.cancel_reason ? <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">Cancelada: {s.cancel_reason}</p> : null}
              <FinTable
                label="Itens da venda"
                rows={s.items}
                rowKey={(i) => i.id}
                columns={[
                  { header: "Item", role: "title", cell: (i) => i.description },
                  { header: "Qtd.", cell: (i) => Number(i.quantity) },
                  { header: "Preço", nowrap: true, className: "tabular-nums", cell: (i) => formatBRL(i.unit_price_cents) },
                  { header: "Desconto", nowrap: true, className: "tabular-nums", cell: (i) => formatBRL(i.discount_item_cents + i.discount_share_cents) },
                  { header: "Líquido", nowrap: true, className: "tabular-nums", cell: (i) => formatBRL(i.net_cents) },
                ]}
              />
              {s.payments.length > 0 ? (
                <FinTable
                  label="Recebimentos"
                  rows={s.payments}
                  rowKey={(p) => p.id}
                  columns={[
                    { header: "Forma", role: "title", cell: (p) => `${p.acquirer_name}${p.brand ? ` · ${p.brand}` : ""}` },
                    { header: "Situação", role: "badge", cell: (p) => <Badge tone={p.status === "active" ? "success" : "muted"}>{p.status === "active" ? "Ativo" : "Estornado"}</Badge> },
                    { header: "Data", nowrap: true, cell: (p) => br(p.paid_on) },
                    { header: "Parcelas", cell: (p) => `${p.installments}×` },
                    { header: "Valor", nowrap: true, className: "tabular-nums", cell: (p) => formatBRL(p.amount_cents) },
                    { header: "NSU", cell: (p) => p.nsu ?? "—" },
                  ]}
                />
              ) : null}
              {s.receivables.length > 0 ? (
                <FinTable
                  label="Títulos da venda"
                  rows={s.receivables}
                  rowKey={(r) => r.id}
                  columns={[
                    { header: "Parcela", role: "title", cell: (r) => `${r.installment_no}/${r.installments}` },
                    { header: "Situação", role: "badge", cell: (r) => RECEIVABLE_STATUS_LABEL[r.status] },
                    { header: "Bruto", nowrap: true, className: "tabular-nums", cell: (r) => formatBRL(r.gross_cents) },
                    { header: "Taxa", nowrap: true, className: "tabular-nums", cell: (r) => formatBRL(r.fee_cents) },
                    { header: "Líquido", nowrap: true, className: "tabular-nums", cell: (r) => formatBRL(r.net_cents) },
                    { header: "Previsto", nowrap: true, cell: (r) => br(r.expected_date) },
                  ]}
                />
              ) : null}
              <div className="flex flex-wrap gap-2">
                {canPay ? <Button onClick={() => setPaying(true)}>Lançar recebimento</Button> : null}
                {canCancel ? <Button variant="outline" onClick={() => setCanceling(true)}>Cancelar venda</Button> : null}
              </div>
              {paying ? <PaymentDialog clinicId={clinicId} saleId={s.id} unitId={s.unit_id} remainingCents={remaining} open onOpenChange={setPaying} /> : null}
              {canceling ? (
                <FormDialog open onOpenChange={setCanceling} title="Cancelar venda" description="Os recebimentos e títulos desta venda ficam como estornados. Nada é apagado." submitLabel="Cancelar venda" pending={cancel.isPending} error={error}
                  onSubmit={() => {
                    if (reason.trim().length < 3) return setError("Informe o motivo do cancelamento.");
                    setError(null);
                    cancel.mutate({ saleId: s.id, reason: reason.trim() }, { onSuccess: () => setCanceling(false), onError: (e) => setError(financeSalesErrorMessage(e)) });
                  }}>
                  <Field label="Motivo do cancelamento" htmlFor="cancel-reason"><Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus /></Field>
                </FormDialog>
              ) : null}
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** Financeiro › Vendas. Profissional vê só as vendas em que é vendedor (o servidor filtra). */
export function SalesTab() {
  const { clinicId, access } = useFinContext();
  const [params, setParams] = useSearchParams();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unitId, setUnitId] = useState("");
  const [status, setStatus] = useState("");
  const [newOpen, setNewOpen] = useState(params.get("novo") === "1");
  const [openSale, setOpenSale] = useState<string | null>(null);
  const canRead = canSeeSales(access);
  const canWrite = finCan(access, "sales", "write");
  const units = useUnits(clinicId, canRead && canWrite).data ?? [];
  const q = useSales(clinicId, { unitId, status: status as SaleStatus | "", from, to }, canRead);
  const initialPatient = params.get("paciente") ? { id: params.get("paciente") as string, name: params.get("nome") ?? "Paciente" } : null;
  if (!clinicId) return <LoadingState />;
  if (!canRead) return <NoAccess />;
  const rows = q.data ?? [];
  const own = !canWrite && !finCan(access, "sales");
  const columns: ExportColumn<SaleRow>[] = [
    { header: "Data", value: (r) => br(r.created_at) }, { header: "Unidade", value: (r) => r.unit_name }, { header: "Paciente", value: (r) => r.patient_name },
    { header: "Vendedor", value: (r) => r.seller_name }, { header: "Itens", value: (r) => r.items_count, kind: "qty" }, { header: "Total (R$)", value: (r) => r.total_net_cents, kind: "money" },
    { header: "Recebido (R$)", value: (r) => r.paid_cents, kind: "money" }, { header: "Situação", value: (r) => SALE_STATUS_LABEL[r.status] },
  ];
  const closeNew = (o: boolean) => { setNewOpen(o); if (!o && params.has("novo")) setParams({}, { replace: true }); };

  return (
    <div className="min-w-0 space-y-4">
      {own ? <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm" role="note">Você vê só a sua produção: as vendas em que você é o vendedor.</p> : null}
      <FilterBar idPrefix="sales" from={from} to={to} onFrom={setFrom} onTo={setTo} units={canWrite ? units : undefined} unitId={unitId} onUnit={setUnitId} statuses={statuses} status={status} onStatus={setStatus} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ExportButtons columns={columns} rows={rows} filename="vendas" sheetName="Vendas" />
        {canWrite ? <Button onClick={() => setNewOpen(true)}><Plus aria-hidden /> Nova venda</Button> : null}
      </div>
      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={Receipt} title="Nenhuma venda no período" description="Registre a venda de um serviço, pacote ou produto; o recebimento é lançado na própria venda." action={canWrite ? <Button onClick={() => setNewOpen(true)}>Nova venda</Button> : undefined} />
      ) : (
        <FinTable<SaleRow>
          label="Vendas"
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            { header: "Paciente", role: "title", cell: (r) => r.patient_name ?? "—" },
            { header: "Situação", role: "badge", cell: (r) => <Badge tone={tone(r.status)}>{SALE_STATUS_LABEL[r.status]}</Badge> },
            { header: "Data", nowrap: true, cell: (r) => br(r.created_at) },
            { header: "Unidade", cell: (r) => r.unit_name },
            { header: "Vendedor", cell: (r) => r.seller_name ?? "—" },
            { header: "Total", nowrap: true, className: "tabular-nums", cell: (r) => formatBRL(r.total_net_cents) },
            { header: "Recebido", nowrap: true, className: "tabular-nums", cell: (r) => formatBRL(r.paid_cents) },
            { header: "Ações", role: "action", cell: (r) => <Button size="sm" variant="outline" onClick={() => setOpenSale(r.id)} aria-label={`Abrir venda de ${r.patient_name ?? "paciente"}`}>Abrir</Button> },
          ]}
        />
      )}
      {newOpen && canWrite ? <NewSaleDialog key={initialPatient?.id ?? "n"} clinicId={clinicId} isAdmin={access.isAdmin} open onOpenChange={closeNew} initialPatient={initialPatient} onSaved={(id) => setOpenSale(id)} /> : null}
      {openSale ? <SaleDetail clinicId={clinicId} saleId={openSale} onClose={() => setOpenSale(null)} /> : null}
    </div>
  );
}
