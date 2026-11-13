import { useMemo, useState } from "react";
import { Package as PackageIcon, Plus, Trash2 } from "lucide-react";

import { ActiveBadge, CentsInput, CheckField, DecimalInput, ExportButtons, Field, FinTable, FormDialog, NativeSelect, ReasonField } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinContext, usePackages, useSavePackage, useServices, useStockItems } from "@/hooks/useFin";
import type { FinPackage } from "@/lib/api/finCatalog";
import { finCan } from "@/lib/domain/finAccess";
import { formatBRL } from "@/lib/domain/finance";
import { formatDecimalBR } from "@/lib/domain/money";
import { allocatePackage } from "@/lib/domain/packageAllocation";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";

interface Line { itemType: "service" | "product"; refId: string; quantity: number | null; referenceCents: number | null }

const serverMessage = (e: unknown): string => {
  const m = (e as { message?: string }).message ?? "";
  if (m.includes("duplicate")) return "Já existe um pacote com esse nome.";
  if (m.includes("REASON_REQUIRED")) return "Informe o motivo da desativação.";
  if (m.includes("INVALID_PRODUCT")) return "Produto do pacote deve ser um item de revenda ou manipulado.";
  if (m.includes("REFERENCE_SUM_REQUIRED")) return "Informe o valor de referência de pelo menos uma linha.";
  if ((e as { code?: string }).code === "42501") return "Você não tem permissão para esta ação.";
  return "Não foi possível salvar agora. Tente novamente.";
};

function PackageDialog({ clinicId, pkg, canWrite, onClose }: { clinicId: string; pkg: FinPackage | "new" | null; canWrite: boolean; onClose: () => void }) {
  const editing = pkg && pkg !== "new" ? pkg : null;
  const services = (useServices(clinicId).data ?? []).filter((s) => s.is_active);
  const products = (useStockItems(clinicId).data ?? []).filter((i) => i.is_active && (i.item_type === "resale" || i.item_type === "compounded"));
  const save = useSavePackage(clinicId);
  const [name, setName] = useState(editing?.name ?? "");
  const [price, setPrice] = useState<number | null>(editing?.price_cents ?? null);
  const [days, setDays] = useState<number | null>(editing?.validity_days ?? 90);
  const [active, setActive] = useState(editing?.is_active ?? true);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Line[]>(
    (editing?.items ?? []).map((i) => ({ itemType: i.item_type, refId: (i.item_type === "service" ? i.service_id : i.stock_item_id) ?? "", quantity: i.quantity, referenceCents: i.reference_price_cents })),
  );
  const deactivating = Boolean(editing && editing.is_active && !active);

  const allocation = useMemo(() => {
    const ready = lines.every((l) => l.quantity && l.quantity > 0 && l.referenceCents !== null);
    if (!ready || price === null) return null;
    return allocatePackage(price, lines.map((l) => ({ quantity: l.quantity as number, referenceCents: l.referenceCents as number })));
  }, [lines, price]);
  const nameOf = (l: Line) => (l.itemType === "service" ? services.find((s) => s.id === l.refId)?.name : products.find((p) => p.id === l.refId)?.name) ?? "—";
  const setLine = (i: number, patch: Partial<Line>) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const exportCols: ExportColumn<{ line: Line; i: number }>[] = [
    { header: "Tipo", value: ({ line }) => (line.itemType === "service" ? "Sessão" : "Produto/manipulado") },
    { header: "Item", value: ({ line }) => nameOf(line) },
    { header: "Quantidade", value: ({ line }) => line.quantity, kind: "qty" },
    { header: "Referência por unidade (R$)", value: ({ line }) => line.referenceCents, kind: "money" },
    { header: "Valor rateado por unidade (R$)", value: ({ i }) => allocation?.lines[i].unitCents, kind: "money" },
    { header: "Valor rateado da linha (R$)", value: ({ i }) => allocation?.lines[i].totalCents, kind: "money" },
  ];

  function submit() {
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = "Informe o nome do pacote.";
    if (price === null || price <= 0) found.price = "Informe o valor do pacote.";
    if (!days || days < 1) found.days = "Informe a validade em dias.";
    const bad = lines.findIndex((l) => !l.refId || !l.quantity || l.quantity <= 0 || l.referenceCents === null);
    if (bad >= 0) found[`line${bad}`] = "Cada linha precisa de item, quantidade e valor de referência.";
    if (deactivating && reason.trim().length < 3) found.reason = "Informe o motivo da desativação.";
    setFe(found);
    if (Object.keys(found).length > 0) return setError(null);
    if (price === null || !days) return;
    if (lines.length === 0) return setError("Adicione ao menos uma sessão ou produto.");
    if (!allocation) return setError("Os valores de referência precisam somar mais que zero.");
    setError(null);
    save.mutate({
      id: editing?.id ?? null, name: name.trim(), priceCents: price, validityDays: days, isActive: active, reason: reason.trim() || undefined,
      items: lines.map((l) => ({
        itemType: l.itemType, serviceId: l.itemType === "service" ? l.refId : null, stockItemId: l.itemType === "product" ? l.refId : null,
        quantity: l.quantity as number, referencePriceCents: l.referenceCents as number,
      })),
    }, { onSuccess: onClose, onError: (e) => { const m = serverMessage(e); if (m.startsWith("Já existe")) { setFe({ name: m }); setError(null); } else setError(m); } });
  }

  return (
    <FormDialog open={pkg !== null} onOpenChange={(o) => (!o ? onClose() : undefined)} title={editing ? (canWrite ? "Editar pacote" : "Ver pacote") : "Novo pacote"} onSubmit={submit} pending={save.isPending} error={error} readOnly={!canWrite} wide>
      <fieldset disabled={!canWrite} className="min-w-0 space-y-4">
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <Field label="Nome" htmlFor="pkg-name" error={fe.name}><Input id="pkg-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus /></Field>
          <Field label="Valor do pacote (R$)" htmlFor="pkg-price" error={fe.price}><CentsInput id="pkg-price" value={price} onChange={setPrice} /></Field>
          <Field label="Validade (dias)" htmlFor="pkg-days" error={fe.days}><DecimalInput id="pkg-days" value={days} onChange={(v) => setDays(v === null ? null : Math.round(v))} maxDecimals={0} /></Field>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Composição</p>
          <p className="text-xs text-muted-foreground">Sessões (serviço × quantidade × valor de referência) e produtos ou manipulados. O valor rateado de cada linha é a referência × (valor do pacote ÷ soma das referências); a diferença de arredondamento fica na última linha.</p>
          {lines.map((l, i) => (
            <div key={i} className="grid min-w-0 grid-cols-2 items-end gap-2 rounded-md border p-2 md:grid-cols-[7rem_minmax(0,1fr)_5rem_8rem_auto_auto]">
              <Field label="Tipo" htmlFor={`pkg-t-${i}`}>
                <NativeSelect id={`pkg-t-${i}`} value={l.itemType} onChange={(e) => setLine(i, { itemType: e.target.value as Line["itemType"], refId: "" })}>
                  <option value="service">Sessão</option><option value="product">Produto</option>
                </NativeSelect>
              </Field>
              <Field label="Item" htmlFor={`pkg-i-${i}`} error={fe[`line${i}`]}>
                <NativeSelect id={`pkg-i-${i}`} value={l.refId} onChange={(e) => setLine(i, { refId: e.target.value })}>
                  <option value="">Selecione…</option>
                  {(l.itemType === "service" ? services : products).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Qtd." htmlFor={`pkg-q-${i}`}><DecimalInput id={`pkg-q-${i}`} value={l.quantity} onChange={(v) => setLine(i, { quantity: v })} /></Field>
              <Field label="Referência (R$)" htmlFor={`pkg-r-${i}`}><CentsInput id={`pkg-r-${i}`} value={l.referenceCents} onChange={(v) => setLine(i, { referenceCents: v })} /></Field>
              <div className="min-w-0 text-sm" aria-label={`Valor rateado da linha ${i + 1}`}>
                <p className="text-xs text-muted-foreground">Rateado</p>
                <p className="font-medium tabular-nums">{allocation ? formatBRL(allocation.lines[i].unitCents) : "—"}<span className="text-xs font-normal text-muted-foreground"> /un.</span></p>
                {allocation && allocation.lines[i].adjustCents !== 0 ? <p className="text-xs text-muted-foreground">+{formatBRL(allocation.lines[i].adjustCents)} de ajuste</p> : null}
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remover linha ${i + 1}`} onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}><Trash2 aria-hidden /></Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((c) => [...c, { itemType: "service", refId: "", quantity: 1, referenceCents: null }])}><Plus aria-hidden /> Adicionar sessão</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((c) => [...c, { itemType: "product", refId: "", quantity: 1, referenceCents: null }])}><Plus aria-hidden /> Adicionar produto</Button>
          </div>
          {allocation ? (
            <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm" role="status">
              <p>Soma das referências: <strong>{formatBRL(allocation.referenceSumCents)}</strong> · fator: <strong>{formatDecimalBR(allocation.factor, 4)}</strong> · total rateado: <strong>{formatBRL(allocation.lines.reduce((s, l) => s + l.totalCents, 0))}</strong></p>
              <ExportButtons columns={exportCols} rows={lines.map((line, i) => ({ line, i }))} filename="composicao-pacote" sheetName="Composição" />
            </div>
          ) : null}
        </div>
        {editing ? <CheckField id="pkg-active" label="Pacote ativo" checked={active} onChange={setActive} /> : null}
        {editing && canWrite ? <ReasonField value={reason} onChange={setReason} required={deactivating} error={fe.reason} /> : null}
      </fieldset>
    </FormDialog>
  );
}

/** Cadastros › Pacotes e programas. */
export function PackagesTab() {
  const { clinicId, access } = useFinContext();
  const canRead = finCan(access, "packages");
  const canWrite = finCan(access, "packages", "write");
  const q = usePackages(clinicId, canRead);
  const [editing, setEditing] = useState<FinPackage | "new" | null>(null);
  if (!clinicId) return <LoadingState />;
  if (!canRead) return <NoAccess />;
  const rows = q.data ?? [];
  const columns: ExportColumn<FinPackage>[] = [
    { header: "Pacote", value: (p) => p.name },
    { header: "Valor (R$)", value: (p) => p.price_cents, kind: "money" },
    { header: "Validade (dias)", value: (p) => p.validity_days, kind: "qty" },
    { header: "Linhas", value: (p) => p.items.length, kind: "qty" },
    { header: "Ativo", value: (p) => p.is_active },
  ];
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ExportButtons columns={columns} rows={rows} filename="pacotes" sheetName="Pacotes" />
        {canWrite ? <Button onClick={() => setEditing("new")}><Plus aria-hidden /> Novo pacote</Button> : null}
      </div>
      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={PackageIcon} title="Nenhum pacote cadastrado" description="Monte programas com sessões e produtos; o valor é rateado entre as linhas." action={canWrite ? <Button onClick={() => setEditing("new")}>Novo pacote</Button> : undefined} />
      ) : (
        <FinTable
          label="Pacotes e programas" rows={rows} rowKey={(p) => p.id}
          columns={[
            { header: "Pacote", role: "title", cell: (p) => p.name },
            { header: "Situação", role: "badge", cell: (p) => <ActiveBadge active={p.is_active} /> },
            { header: "Valor", nowrap: true, cell: (p) => formatBRL(p.price_cents) },
            { header: "Validade", cell: (p) => `${p.validity_days} dias` },
            { header: "Composição", cell: (p) => `${p.items.length} ${p.items.length === 1 ? "linha" : "linhas"}` },
            { header: "Ações", role: "action", cell: (p) => <Button size="sm" variant="outline" onClick={() => setEditing(p)} aria-label={`${canWrite ? "Editar" : "Ver"} ${p.name}`}>{canWrite ? "Editar" : "Ver"}</Button> },
          ]}
        />
      )}
      {editing ? <PackageDialog key={editing === "new" ? "new" : editing.id} clinicId={clinicId} pkg={editing} canWrite={canWrite} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
