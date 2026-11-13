// Financeiro › Vendas (Entrega 2): lista com filtros, nova venda, detalhe com itens, recebimentos e títulos, cancelamento com motivo.
import { useState } from "react";
import { Receipt, Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { ExportButtons, Field, FormDialog, TableShell, Td, Th } from "@/components/fin/FinUi";
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
const br = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
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
              <TableShell label="Itens da venda">
                <thead><tr><Th>Item</Th><Th>Qtd.</Th><Th>Preço</Th><Th>Desconto</Th><Th>Líquido</Th></tr></thead>
                <tbody>{s.items.map((i) => (
                  <tr key={i.id}><Td className="font-medium">{i.description}</Td><Td>{Number(i.quantity)}</Td><Td className="tabular-nums">{formatBRL(i.unit_price_cents)}</Td>
                    <Td className="tabular-nums">{formatBRL(i.discount_item_cents + i.discount_share_cents)}</Td><Td className="tabular-nums">{formatBRL(i.net_cents)}</Td></tr>
                ))}</tbody>
              </TableShell>
              {s.payments.length > 0 ? (
                <TableShell label="Recebimentos">
                  <thead><tr><Th>Data</Th><Th>Forma</Th><Th>Parcelas</Th><Th>Valor</Th><Th>NSU</Th><Th>Situação</Th></tr></thead>
                  <tbody>{s.payments.map((p) => (
                    <tr key={p.id}><Td>{br(p.paid_on)}</Td><Td>{p.acquirer_name}{p.brand ? ` · ${p.brand}` : ""}</Td><Td>{p.installments}×</Td><Td className="tabular-nums">{formatBRL(p.amount_cents)}</Td><Td>{p.nsu ?? "—"}</Td>
                      <Td><Badge tone={p.status === "active" ? "success" : "muted"}>{p.status === "active" ? "Ativo" : "Estornado"}</Badge></Td></tr>
                  ))}</tbody>
                </TableShell>
              ) : null}
              {s.receivables.length > 0 ? (
                <TableShell label="Títulos da venda">
                  <thead><tr><Th>Parcela</Th><Th>Bruto</Th><Th>Taxa</Th><Th>Líquido</Th><Th>Previsto</Th><Th>Situação</Th></tr></thead>
                  <tbody>{s.receivables.map((r) => (
                    <tr key={r.id}><Td>{r.installment_no}/{r.installments}</Td><Td className="tabular-nums">{formatBRL(r.gross_cents)}</Td><Td className="tabular-nums">{formatBRL(r.fee_cents)}</Td><Td className="tabular-nums">{formatBRL(r.net_cents)}</Td>
                      <Td>{br(r.expected_date)}</Td><Td>{RECEIVABLE_STATUS_LABEL[r.status]}</Td></tr>
                  ))}</tbody>
                </TableShell>
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
        <TableShell label="Vendas">
          <thead><tr><Th>Data</Th><Th>Paciente</Th><Th>Unidade</Th><Th>Vendedor</Th><Th>Total</Th><Th>Recebido</Th><Th>Situação</Th><Th>Ações</Th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <Td>{br(r.created_at)}</Td><Td className="font-medium">{r.patient_name ?? "—"}</Td><Td>{r.unit_name}</Td><Td>{r.seller_name ?? "—"}</Td>
              <Td className="whitespace-nowrap tabular-nums">{formatBRL(r.total_net_cents)}</Td><Td className="whitespace-nowrap tabular-nums">{formatBRL(r.paid_cents)}</Td>
              <Td><Badge tone={tone(r.status)}>{SALE_STATUS_LABEL[r.status]}</Badge></Td>
              <Td><Button size="sm" variant="outline" onClick={() => setOpenSale(r.id)} aria-label={`Abrir venda de ${r.patient_name ?? "paciente"}`}>Abrir</Button></Td>
            </tr>
          ))}</tbody>
        </TableShell>
      )}
      {newOpen && canWrite ? <NewSaleDialog key={initialPatient?.id ?? "n"} clinicId={clinicId} isAdmin={access.isAdmin} open onOpenChange={closeNew} initialPatient={initialPatient} onSaved={(id) => setOpenSale(id)} /> : null}
      {openSale ? <SaleDetail clinicId={clinicId} saleId={openSale} onClose={() => setOpenSale(null)} /> : null}
    </div>
  );
}
