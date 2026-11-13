import { useMemo, useState } from "react";
import { AlertTriangle, PackageOpen, Plus } from "lucide-react";

import { ActiveBadge, CentsInput, CheckField, DecimalInput, ExportButtons, Field, FinTable, FormDialog, NativeSelect, ReasonField } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinContext, useSaveStockItem, useStockItems, useUnits } from "@/hooks/useFin";
import type { StockItem } from "@/lib/api/stockItems";
import { finCan } from "@/lib/domain/finAccess";
import { formatBRL } from "@/lib/domain/finance";
import { formatDecimalBR } from "@/lib/domain/money";
import {
  applyTypeDefaults, CONTROLLED_NOTICE, STOCK_ITEM_TYPE_LABEL, stockServerErrorMessage, typeLocks, validateStockItem,
  type StockItemDraft, type StockItemType,
} from "@/lib/domain/stockItemRules";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";
import { StockShell } from "@/pages/stock/StockShell";

const EMPTY: StockItemDraft = {
  name: "", category: "", itemType: "consumable", fractional: false, openedValidityDays: null, individualUse: false, lotControl: false,
  sellable: false, salePriceCents: null, controlled: false, purchaseToStock: 1, stockToConsumption: 1, ean: "",
};

interface Extra { manufacturer: string; purchaseUnit: string; stockUnit: string; consumptionUnit: string; anvisaReg: string; active: boolean }

function ItemDialog({ clinicId, item, canWrite, onClose }: { clinicId: string; item: StockItem | "new" | null; canWrite: boolean; onClose: () => void }) {
  const editing = item && item !== "new" ? item : null;
  const units = (useUnits(clinicId).data ?? []).filter((u) => u.is_active);
  const save = useSaveStockItem(clinicId);
  const [d, setD] = useState<StockItemDraft>(editing ? {
    name: editing.name, category: editing.category, itemType: editing.item_type, fractional: editing.fractional, openedValidityDays: editing.opened_validity_days,
    individualUse: editing.individual_use, lotControl: editing.lot_control, sellable: editing.sellable, salePriceCents: editing.sale_price_cents, controlled: false,
    purchaseToStock: editing.purchase_to_stock_factor, stockToConsumption: editing.stock_to_consumption_factor, ean: editing.ean ?? "",
  } : EMPTY);
  const [x, setX] = useState<Extra>({
    manufacturer: editing?.manufacturer ?? "", purchaseUnit: editing?.purchase_unit ?? "un", stockUnit: editing?.stock_unit ?? "un", consumptionUnit: editing?.consumption_unit ?? "un",
    anvisaReg: editing?.anvisa_reg ?? "", active: editing?.is_active ?? true,
  });
  const [mins, setMins] = useState<Record<string, number | null>>(() => Object.fromEntries((editing?.minimums ?? []).map((m) => [m.unit_id, m.min_qty])));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showControlled, setShowControlled] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ReturnType<typeof validateStockItem>>({});
  const locks = typeLocks(d.itemType);
  const deactivating = Boolean(editing && editing.is_active && !x.active);
  const set = (patch: Partial<StockItemDraft>) => setD((cur) => ({ ...cur, ...patch }));
  const setExtra = (patch: Partial<Extra>) => setX((cur) => ({ ...cur, ...patch }));
  const priceRequired = d.itemType === "resale" || (d.itemType === "compounded" && d.sellable);

  function submit() {
    const found = validateStockItem(d);
    setErrors(found);
    if (Object.keys(found).length > 0) { setReasonError(null); return setError("Corrija os campos destacados."); }
    if (deactivating && reason.trim().length < 3) { setReasonError("Informe o motivo da desativação."); return setError(null); }
    setReasonError(null);
    setError(null);
    save.mutate({
      id: editing?.id ?? null, name: d.name.trim(), category: d.category.trim(), manufacturer: x.manufacturer.trim(), itemType: d.itemType, purchaseUnit: x.purchaseUnit.trim() || "un",
      stockUnit: x.stockUnit.trim() || "un", consumptionUnit: x.consumptionUnit.trim() || "un", purchaseToStock: d.purchaseToStock, stockToConsumption: d.stockToConsumption,
      fractional: d.fractional, openedValidityDays: d.fractional ? d.openedValidityDays : null, individualUse: d.individualUse, lotControl: d.lotControl, sellable: d.sellable,
      ean: d.ean.trim(), anvisaReg: x.anvisaReg.trim(), salePriceCents: priceRequired || d.salePriceCents !== null ? d.salePriceCents : null, controlled: false, isActive: x.active,
      minimums: Object.entries(mins).filter(([, v]) => v !== null).map(([unitId, v]) => ({ unitId, minQty: v as number })), reason: reason.trim() || undefined,
    }, { onSuccess: onClose, onError: (e) => setError(stockServerErrorMessage(e)) });
  }

  return (
    <FormDialog open={item !== null} onOpenChange={(o) => (!o ? onClose() : undefined)} title={editing ? (canWrite ? "Editar item" : "Ver item") : "Novo item de estoque"} onSubmit={submit} pending={save.isPending} error={error} readOnly={!canWrite} wide>
      <fieldset disabled={!canWrite} className="min-w-0 space-y-5">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label="Nome" htmlFor="it-name" error={errors.name}><Input id="it-name" value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={160} autoFocus /></Field>
          <Field label="Categoria" htmlFor="it-cat" error={errors.category}><Input id="it-cat" value={d.category} onChange={(e) => set({ category: e.target.value })} maxLength={80} /></Field>
          <Field label="Fabricante" htmlFor="it-man"><Input id="it-man" value={x.manufacturer} onChange={(e) => setExtra({ manufacturer: e.target.value })} maxLength={120} /></Field>
          <Field label="Tipo" htmlFor="it-type">
            <NativeSelect id="it-type" value={d.itemType} onChange={(e) => setD((cur) => applyTypeDefaults(cur, e.target.value as StockItemType, !editing))}>
              {(Object.keys(STOCK_ITEM_TYPE_LABEL) as StockItemType[]).map((t) => <option key={t} value={t}>{STOCK_ITEM_TYPE_LABEL[t]}</option>)}
            </NativeSelect>
          </Field>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Unidades de medida e conversão</p>
          <div className="grid min-w-0 gap-4 sm:grid-cols-3">
            <Field label="Unidade de compra" htmlFor="it-pu"><Input id="it-pu" value={x.purchaseUnit} onChange={(e) => setExtra({ purchaseUnit: e.target.value })} maxLength={30} placeholder="caixa" /></Field>
            <Field label="Unidade de estoque" htmlFor="it-su"><Input id="it-su" value={x.stockUnit} onChange={(e) => setExtra({ stockUnit: e.target.value })} maxLength={30} placeholder="ampola" /></Field>
            <Field label="Unidade de consumo" htmlFor="it-cu"><Input id="it-cu" value={x.consumptionUnit} onChange={(e) => setExtra({ consumptionUnit: e.target.value })} maxLength={30} placeholder="ml" /></Field>
            <Field label={`1 ${x.purchaseUnit || "compra"} = quantas ${x.stockUnit || "estoque"}?`} htmlFor="it-f1" error={errors.factors}><DecimalInput id="it-f1" value={d.purchaseToStock} onChange={(v) => set({ purchaseToStock: v ?? 0 })} maxDecimals={4} /></Field>
            <Field label={`1 ${x.stockUnit || "estoque"} = quantas ${x.consumptionUnit || "consumo"}?`} htmlFor="it-f2"><DecimalInput id="it-f2" value={d.stockToConsumption} onChange={(v) => set({ stockToConsumption: v ?? 0 })} maxDecimals={4} /></Field>
          </div>
        </div>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <CheckField id="it-frac" label="Uso fracionado" checked={d.fractional} onChange={(v) => set({ fractional: v, openedValidityDays: v ? d.openedValidityDays ?? 28 : null })} hint="A saída pode ser uma fração da unidade de estoque (até 3 casas)." />
            {d.fractional ? <Field label="Validade após aberto (dias)" htmlFor="it-open" error={errors.openedValidity}><DecimalInput id="it-open" value={d.openedValidityDays} onChange={(v) => set({ openedValidityDays: v === null ? null : Math.round(v) })} maxDecimals={0} /></Field> : null}
            <CheckField id="it-ind" label="Uso individual por paciente" checked={d.individualUse} onChange={(v) => set({ individualUse: v })} hint="Ao abrir, a unidade fica vinculada a um único paciente (ex.: caneta multidose)." />
          </div>
          <div className="space-y-2">
            <CheckField id="it-lot" label="Controla lote e validade" checked={locks.lotControl.locked ? Boolean(locks.lotControl.value) : d.lotControl} disabled={locks.lotControl.locked} onChange={(v) => set({ lotControl: v })} hint={locks.lotControl.locked ? "Obrigatório para medicação aplicada e manipulado." : undefined} />
            {errors.lotControl ? <p className="text-xs text-destructive" role="alert">{errors.lotControl}</p> : null}
            <CheckField id="it-sell" label="Venda ao paciente" checked={locks.sellable.locked ? Boolean(locks.sellable.value) : d.sellable} disabled={locks.sellable.locked} onChange={(v) => set({ sellable: v })}
              hint={d.itemType === "medication" ? "Medicação aplicada nunca é entregue nem vendida ao paciente." : d.itemType === "consumable" ? "Material de consumo não é vendido." : d.itemType === "resale" ? "Produto de revenda é vendido ao paciente." : "Manipulado pode ser vendido pela clínica (exige licença sanitária da unidade)."} />
            {errors.sellable ? <p className="text-xs text-destructive" role="alert">{errors.sellable}</p> : null}
            {(d.sellable || d.itemType === "resale") && d.itemType !== "medication" ? (
              <Field label={`Preço de venda (R$)${priceRequired ? "" : " — opcional"}`} htmlFor="it-price" error={errors.salePrice}><CentsInput id="it-price" value={d.salePriceCents} onChange={(v) => set({ salePriceCents: v })} /></Field>
            ) : null}
          </div>
        </div>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label="Código de barras / EAN" htmlFor="it-ean" error={errors.ean}><Input id="it-ean" inputMode="numeric" value={d.ean} onChange={(e) => set({ ean: e.target.value })} maxLength={14} /></Field>
          <Field label="Registro Anvisa" htmlFor="it-anvisa"><Input id="it-anvisa" value={x.anvisaReg} onChange={(e) => setExtra({ anvisaReg: e.target.value })} maxLength={40} /></Field>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Estoque mínimo por unidade da clínica ({x.stockUnit || "un"})</p>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {units.map((u) => (
              <Field key={u.id} label={u.name} htmlFor={`it-min-${u.id}`}>
                <DecimalInput id={`it-min-${u.id}`} value={mins[u.id] ?? null} onChange={(v) => setMins((cur) => ({ ...cur, [u.id]: v }))} placeholder="Sem mínimo" />
              </Field>
            ))}
          </div>
        </div>

        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
          <label htmlFor="it-controlled" className="flex items-start gap-2 text-sm">
            <input id="it-controlled" type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={false} onChange={() => setShowControlled(true)} />
            <span>Controlado (Portaria 344)</span>
          </label>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground" role={showControlled ? "alert" : undefined}>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {CONTROLLED_NOTICE}
          </p>
        </div>

        {editing ? <CheckField id="it-active" label="Item ativo" checked={x.active} onChange={(v) => setExtra({ active: v })} /> : null}
        {editing && canWrite ? <ReasonField value={reason} onChange={setReason} required={deactivating} error={reasonError} /> : null}
      </fieldset>
    </FormDialog>
  );
}

/** Estoque › Itens (Entrega 1). Saldo, entradas, saídas e movimentações são as outras abas (Entrega 3); inventário e transferências, a Entrega 8. */
export function StockPage() {
  const { clinicId, access, isLoading } = useFinContext();
  const canRead = finCan(access, "stock_items");
  const canWrite = finCan(access, "stock_items", "write");
  const q = useStockItems(clinicId, canRead);
  const units = useUnits(clinicId, canRead);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [editing, setEditing] = useState<StockItem | "new" | null>(null);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((i) => (showInactive || i.is_active) && (!type || i.item_type === type) && (!s || `${i.name} ${i.category} ${i.manufacturer ?? ""}`.toLowerCase().includes(s)));
  }, [q.data, search, type, showInactive]);
  const unitName = (id: string) => (units.data ?? []).find((u) => u.id === id)?.name ?? "Unidade";

  const columns: ExportColumn<StockItem>[] = [
    { header: "Item", value: (i) => i.name },
    { header: "Categoria", value: (i) => i.category },
    { header: "Fabricante", value: (i) => i.manufacturer },
    { header: "Tipo", value: (i) => STOCK_ITEM_TYPE_LABEL[i.item_type] },
    { header: "Unidade de compra", value: (i) => i.purchase_unit },
    { header: "Unidade de estoque", value: (i) => i.stock_unit },
    { header: "Unidade de consumo", value: (i) => i.consumption_unit },
    { header: "Fator compra → estoque", value: (i) => i.purchase_to_stock_factor, kind: "qty" },
    { header: "Fator estoque → consumo", value: (i) => i.stock_to_consumption_factor, kind: "qty" },
    { header: "Controla lote e validade", value: (i) => i.lot_control },
    { header: "Uso fracionado", value: (i) => i.fractional },
    { header: "Venda ao paciente", value: (i) => i.sellable },
    { header: "Preço de venda (R$)", value: (i) => i.sale_price_cents, kind: "money" },
    { header: "Estoque mínimo", value: (i) => i.minimums.map((m) => `${unitName(m.unit_id)}: ${formatDecimalBR(m.min_qty, 3).replace(/,?0+$/, "")}`).join(" | ") },
    { header: "Ativo", value: (i) => i.is_active },
  ];

  return (
    <StockShell
      description="Itens de estoque da clínica: medicações aplicadas, manipulados, produtos de revenda e materiais de consumo."
      actions={canWrite ? <Button onClick={() => setEditing("new")}><Plus aria-hidden /> Novo item</Button> : undefined}
    >
      {isLoading || (q.isLoading && canRead) ? <LoadingState /> : !canRead ? <NoAccess text="O estoque é do administrador, do gestor, do estoquista e do financeiro (consulta)." /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <div className="min-w-0 space-y-4">
          {!canWrite ? <Badge tone="muted">Consulta: você vê os itens, mas não altera</Badge> : null}
          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto]">
            <Field label="Buscar" htmlFor="stk-search"><Input id="stk-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, categoria ou fabricante" /></Field>
            <Field label="Tipo" htmlFor="stk-type">
              <NativeSelect id="stk-type" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">Todos</option>
                {(Object.keys(STOCK_ITEM_TYPE_LABEL) as StockItemType[]).map((t) => <option key={t} value={t}>{STOCK_ITEM_TYPE_LABEL[t]}</option>)}
              </NativeSelect>
            </Field>
            <div className="flex items-end pb-2"><CheckField id="stk-inactive" label="Mostrar inativos" checked={showInactive} onChange={setShowInactive} /></div>
          </div>
          <ExportButtons columns={columns} rows={rows} filename="itens-de-estoque" sheetName="Itens" />
          {rows.length === 0 ? (
            <EmptyState icon={PackageOpen} title={(q.data ?? []).length === 0 ? "Nenhum item cadastrado" : "Nenhum item com esse filtro"} description={(q.data ?? []).length === 0 ? "Cadastre os itens para montar kits de serviço e controlar o estoque." : "Ajuste a busca ou o tipo."}
              action={canWrite && (q.data ?? []).length === 0 ? <Button onClick={() => setEditing("new")}>Novo item</Button> : undefined} />
          ) : (
            <FinTable
              label="Itens de estoque" rows={rows} rowKey={(i) => i.id}
              columns={[
                { header: "Item", role: "title", cell: (i) => <>{i.name}<span className="block text-xs font-normal text-muted-foreground">{i.category}{i.manufacturer ? ` · ${i.manufacturer}` : ""}</span></> },
                { header: "Situação", role: "badge", cell: (i) => <ActiveBadge active={i.is_active} /> },
                { header: "Tipo", cell: (i) => STOCK_ITEM_TYPE_LABEL[i.item_type] },
                { header: "Unidades", wide: true, cell: (i) => <>{i.purchase_unit} → {i.stock_unit} → {i.consumption_unit}{i.fractional ? <Badge tone="info" className="ml-1">Fracionado</Badge> : null}</> },
                { header: "Lote", cell: (i) => (i.lot_control ? "Sim" : "Não") },
                { header: "Venda", nowrap: true, cell: (i) => (i.sellable ? formatBRL(i.sale_price_cents) : "—") },
                { header: "Mínimo", nowrap: true, cell: (i) => (i.minimums.length === 0 ? "—" : i.minimums.map((m) => `${formatDecimalBR(m.min_qty, 3).replace(/,?0+$/, "")}`).join(" / ")) },
                { header: "Ações", role: "action", cell: (i) => <Button size="sm" variant="outline" onClick={() => setEditing(i)} aria-label={`${canWrite ? "Editar" : "Ver"} ${i.name}`}>{canWrite ? "Editar" : "Ver"}</Button> },
              ]}
            />
          )}
        </div>
      )}
      {clinicId && editing ? <ItemDialog key={editing === "new" ? "new" : editing.id} clinicId={clinicId} item={editing} canWrite={canWrite} onClose={() => setEditing(null)} /> : null}
    </StockShell>
  );
}
