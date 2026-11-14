// Inventário: abrir contagem e contar item que a lista não trazia (Entrega 8).
import { useMemo, useState } from "react";

import { CheckField, Field, FormDialog, NativeSelect } from "@/components/fin/FinUi";
import { Input } from "@/components/ui/input";
import { useStockItems } from "@/hooks/useFin";
import { useCountInventory, useOpenInventory } from "@/hooks/useStockE8";
import { e8ErrorMessage, ITEM_TYPE_LABEL, parseCountText, SCOPE_LABEL } from "@/lib/domain/stockE8";

interface UnitOpt { id: string; name: string }

export function OpenInventoryDialog({ clinicId, units, defaultUnit, onClose, onOpened }: { clinicId: string; units: UnitOpt[]; defaultUnit: string; onClose: () => void; onOpened: (id: string) => void }) {
  const [unitId, setUnitId] = useState(defaultUnit || units[0]?.id || "");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"all" | "category" | "type">("all");
  const [scopeValue, setScopeValue] = useState("");
  const [blind, setBlind] = useState(true);
  const [notes, setNotes] = useState("");
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = useStockItems(clinicId);
  const categories = useMemo(() => [...new Set((items.data ?? []).filter((i) => i.is_active).map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [items.data]);
  const open = useOpenInventory(clinicId);
  const submit = () => {
    setError(null);
    if (scope !== "all" && !scopeValue) return setFieldErr(scope === "category" ? "Escolha a categoria." : "Escolha o tipo.");
    setFieldErr(null);
    open.mutate({ unitId, data: { name, notes, scope, scopeValue: scope === "all" ? undefined : scopeValue, blind } }, { onSuccess: (id) => { onOpened(id); onClose(); }, onError: (e) => setError(e8ErrorMessage(e)) });
  };
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title="Abrir inventário" submitLabel="Abrir contagem" pending={open.isPending} error={error} onSubmit={submit}
      description="O saldo de cada item e lote é congelado agora como o esperado. Na contagem cega, quem conta não vê esse saldo.">
      <Field label="Unidade" htmlFor="iv-unit"><NativeSelect id="iv-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect></Field>
      <Field label="Nome (opcional)" htmlFor="iv-name" hint="Ex.: Inventário de novembro"><Input id="iv-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
      <Field label="O que contar" htmlFor="iv-scope"><NativeSelect id="iv-scope" value={scope} onChange={(e) => { setScope(e.target.value as typeof scope); setScopeValue(""); setFieldErr(null); }}>{Object.entries(SCOPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
      {scope === "category" ? <Field label="Categoria" htmlFor="iv-cat" error={fieldErr}><NativeSelect id="iv-cat" value={scopeValue} onChange={(e) => setScopeValue(e.target.value)}><option value="">Escolha…</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</NativeSelect></Field> : null}
      {scope === "type" ? <Field label="Tipo de item" htmlFor="iv-type" error={fieldErr}><NativeSelect id="iv-type" value={scopeValue} onChange={(e) => setScopeValue(e.target.value)}><option value="">Escolha…</option>{Object.entries(ITEM_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field> : null}
      <CheckField id="iv-blind" label="Contagem cega (recomendado)" checked={blind} onChange={setBlind} hint="Quem conta não vê o saldo esperado; o gestor vê esperado × contado × valor na revisão." />
      <Field label="Observação (opcional)" htmlFor="iv-notes"><Input id="iv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} /></Field>
    </FormDialog>
  );
}

export function ExtraLineDialog({ clinicId, inventoryId, onClose }: { clinicId: string; inventoryId: string; onClose: () => void }) {
  const items = useStockItems(clinicId);
  const [itemId, setItemId] = useState("");
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [qty, setQty] = useState("");
  const [fieldErr, setFieldErr] = useState<{ item?: string; qty?: string; lot?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const count = useCountInventory();
  const list = (items.data ?? []).filter((i) => i.is_active);
  const item = list.find((i) => i.id === itemId);
  const submit = () => {
    const e: typeof fieldErr = {};
    if (!item) e.item = "Escolha o item.";
    const p = parseCountText(qty, item?.fractional ?? false);
    if (!p.ok) e.qty = p.error; else if (p.qty === null) e.qty = "Informe a quantidade contada.";
    if (item?.lot_control && (!lot.trim() || !expiry)) e.lot = "Item com controle de lote: informe lote e validade.";
    setFieldErr(e); setError(null);
    if (e.item || e.qty || e.lot || !p.ok) return;
    count.mutate({ inventoryId, lines: [{ itemId, lotCode: lot.trim() || undefined, expiryDate: expiry || null, countedQty: p.qty }] }, { onSuccess: onClose, onError: (err) => setError(e8ErrorMessage(err)) });
  };
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title="Contar item fora da lista" submitLabel="Registrar contagem" pending={count.isPending} error={error} onSubmit={submit}
      description="Use para o que está na prateleira mas não constava no saldo (item ou lote novo).">
      <Field label="Item" htmlFor="ex-item" error={fieldErr.item}><NativeSelect id="ex-item" value={itemId} onChange={(e) => setItemId(e.target.value)}><option value="">Escolha…</option>{list.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</NativeSelect></Field>
      <div className="flex min-w-0 flex-wrap gap-3">
        <Field label="Lote" htmlFor="ex-lot" className="min-w-[8rem] flex-1" error={fieldErr.lot}><Input id="ex-lot" value={lot} onChange={(e) => setLot(e.target.value)} maxLength={40} /></Field>
        <Field label="Validade" htmlFor="ex-exp" className="min-w-[10rem]"><Input id="ex-exp" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
        <Field label="Quantidade contada" htmlFor="ex-qty" className="w-40" error={fieldErr.qty} hint={item?.stock_unit}><Input id="ex-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
      </div>
    </FormDialog>
  );
}
