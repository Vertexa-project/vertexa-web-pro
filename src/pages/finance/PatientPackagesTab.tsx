// Financeiro › Pacotes dos pacientes (Entrega 4): saldo de sessões e de itens de cada pacote vendido, entrega de item ao paciente (baixa o estoque) e vencimento.
// Quem lê: Admin, Gestor, Financeiro e Recepção. Quem entrega o item: Admin, Gestor, Estoquista e Recepção.
import { useState } from "react";
import { PackageOpen } from "lucide-react";

import { DecimalInput, ExportButtons, Field, FinTable, FormDialog, NativeSelect } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFinContext, useUnits } from "@/hooks/useFin";
import { useDeliverPackageItem, usePatientPackages } from "@/hooks/useFinAppointments";
import type { PatientPackageItem, PatientPackageRow } from "@/lib/api/finAppointments";
import { canDeliverPackageItem, canSeePatientPackages } from "@/lib/domain/finAccess";
import { apptErrorMessage, packageState } from "@/lib/domain/finAppointments";
import { formatBRL } from "@/lib/domain/finance";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { formatQty } from "@/lib/domain/stockMoves";
import { NoAccess } from "@/pages/finance/NoAccess";

const br = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const balanceText = (p: PatientPackageRow) => p.items.map((i) => `${i.name}: ${formatQty(i.qty_used)}/${formatQty(i.qty_total)}`).join(" · ");

function DeliverDialog({ clinicId, item, defaultUnitId, onClose }: { clinicId: string; item: PatientPackageItem; defaultUnitId: string; onClose: () => void }) {
  const units = (useUnits(clinicId).data ?? []).filter((u) => u.is_active);
  const [unitId, setUnitId] = useState(defaultUnitId);
  const [qty, setQty] = useState<number | null>(1);
  const [error, setError] = useState<string | null>(null);
  const [qtyError, setQtyError] = useState<string | null>(null);
  const deliver = useDeliverPackageItem();
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={`Entregar — ${item.name}`} submitLabel="Registrar entrega" pending={deliver.isPending} error={error}
      description={`Restam ${formatQty(item.remaining)} deste item no pacote. A entrega baixa o estoque da unidade (o lote que vence primeiro) e cobre o pacote pela data de hoje.`}
      onSubmit={() => {
        if (!qty || qty <= 0 || qty !== Math.trunc(qty)) return setQtyError("Informe uma quantidade inteira maior que zero.");
        if (qty > item.remaining) return setQtyError(`O pacote só tem ${formatQty(item.remaining)} para entregar.`);
        setQtyError(null); setError(null);
        deliver.mutate({ itemId: item.id, qty, unitId }, { onSuccess: onClose, onError: (e) => setError(apptErrorMessage(e)) });
      }}>
      <Field label="Unidade de onde sai" htmlFor="dv-unit">
        <NativeSelect id="dv-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect>
      </Field>
      <Field label="Quantidade entregue" htmlFor="dv-qty" error={qtyError}><DecimalInput id="dv-qty" value={qty} onChange={setQty} maxDecimals={0} /></Field>
    </FormDialog>
  );
}

function PackageDialog({ clinicId, pkg, canDeliver, onClose }: { clinicId: string; pkg: PatientPackageRow; canDeliver: boolean; onClose: () => void }) {
  const [delivering, setDelivering] = useState<PatientPackageItem | null>(null);
  const st = packageState(pkg);
  const usable = pkg.status === "active" && !pkg.expired;
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{pkg.name}</DialogTitle>
          <DialogDescription>{pkg.patient_name ?? "Paciente"} · {pkg.unit_name} · comprado em {br(pkg.purchased_on)} · vence em {br(pkg.expires_on)}</DialogDescription>
        </DialogHeader>
        <DialogBody className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone={st.tone}>{st.label}</Badge>
            {pkg.price_cents !== null ? <span>Valor pago <strong className="tabular-nums">{formatBRL(pkg.price_cents)}</strong></span> : null}
            {pkg.expired && pkg.status === "active" ? <span className="text-muted-foreground">Pacote vencido: o saldo não usado vira receita da clínica, sem repasse.</span> : null}
          </div>
          <FinTable<PatientPackageItem>
            label="Itens do pacote" rows={pkg.items} rowKey={(i) => i.id}
            columns={[
              { header: "Item", role: "title", cell: (i) => i.name },
              { header: "Tipo", role: "badge", cell: (i) => <Badge tone="info">{i.item_type === "service" ? "Sessão" : "Produto"}</Badge> },
              { header: "Usado / entregue", nowrap: true, cell: (i) => `${formatQty(i.qty_used)} de ${formatQty(i.qty_total)}` },
              { header: "Restam", nowrap: true, cell: (i) => formatQty(i.remaining) },
              ...(pkg.price_cents !== null ? [{ header: "Valor rateado", nowrap: true, className: "tabular-nums", cell: (i: PatientPackageItem) => (i.net_total_cents === null ? "—" : formatBRL(i.net_total_cents)) }] : []),
              { header: "Ações", role: "action", cell: (i) => (canDeliver && usable && i.item_type === "product" && i.remaining > 0 ? <Button size="sm" variant="outline" onClick={() => setDelivering(i)} aria-label={`Entregar ${i.name}`}>Entregar</Button> : i.item_type === "service" ? <span className="text-xs text-muted-foreground">Consumida no atendimento</span> : null) },
            ]}
          />
          {delivering ? <DeliverDialog clinicId={clinicId} item={delivering} defaultUnitId={pkg.unit_id} onClose={() => setDelivering(null)} /> : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function PatientPackagesTab() {
  const { clinicId, access } = useFinContext();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "active" | "canceled">("");
  const [openId, setOpenId] = useState<string | null>(null);
  const canRead = canSeePatientPackages(access);
  const q = usePatientPackages(clinicId, { status, search }, canRead);
  if (!clinicId) return <LoadingState />;
  if (!canRead) return <NoAccess />;
  const rows = q.data ?? [];
  const open = rows.find((r) => r.id === openId) ?? null;
  const columns: ExportColumn<PatientPackageRow>[] = [
    { header: "Paciente", value: (r) => r.patient_name }, { header: "Pacote", value: (r) => r.name }, { header: "Unidade", value: (r) => r.unit_name },
    { header: "Comprado em", value: (r) => br(r.purchased_on) }, { header: "Vence em", value: (r) => br(r.expires_on) }, { header: "Situação", value: (r) => packageState(r).label },
    { header: "Saldo", value: balanceText }, { header: "Valor pago (R$)", value: (r) => r.price_cents, kind: "money" },
  ];
  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2" role="search" aria-label="Filtros">
        <Field label="Buscar paciente ou pacote" htmlFor="pp-search"><Input id="pp-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome do paciente ou do pacote" /></Field>
        <Field label="Situação" htmlFor="pp-status">
          <NativeSelect id="pp-status" value={status} onChange={(e) => setStatus(e.target.value as "" | "active" | "canceled")}>
            <option value="">Todas</option><option value="active">Ativos</option><option value="canceled">Cancelados</option>
          </NativeSelect>
        </Field>
      </div>
      <ExportButtons columns={columns} rows={rows} filename="pacotes-dos-pacientes" sheetName="Pacotes" />
      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={PackageOpen} title="Nenhum pacote vendido" description="Quando uma venda de pacote é registrada, o saldo de sessões e itens do paciente aparece aqui." />
      ) : (
        <FinTable<PatientPackageRow>
          label="Pacotes dos pacientes" rows={rows} rowKey={(r) => r.id}
          columns={[
            { header: "Paciente", role: "title", cell: (r) => r.patient_name ?? "—" },
            { header: "Situação", role: "badge", cell: (r) => { const s = packageState(r); return <Badge tone={s.tone}>{s.label}</Badge>; } },
            { header: "Pacote", cell: (r) => r.name },
            { header: "Vence em", nowrap: true, cell: (r) => br(r.expires_on) },
            { header: "Saldo", wide: true, cell: balanceText },
            { header: "Ações", role: "action", cell: (r) => <Button size="sm" variant="outline" onClick={() => setOpenId(r.id)} aria-label={`Abrir pacote ${r.name} de ${r.patient_name ?? "paciente"}`}>Abrir</Button> },
          ]}
        />
      )}
      {open ? <PackageDialog clinicId={clinicId} pkg={open} canDeliver={canDeliverPackageItem(access)} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}
