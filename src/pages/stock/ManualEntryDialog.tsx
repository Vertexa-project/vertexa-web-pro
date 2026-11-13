// Entrada manual (escopo-v1 §8.2): saldo inicial, compra e bonificação/doação. Item, quantidade (unidade de ESTOQUE), custo unitário, lote e
// validade, fornecedor e nota; frete rateado pelo valor dos itens. O servidor revalida tudo e grava a entrada inteira ou nada.
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { DecimalInput, Field, FormDialog, NativeSelect, CentsInput } from "@/components/fin/FinUi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStockItems, useUnits } from "@/hooks/useFin";
import { useCreateEntry, useSuppliers } from "@/hooks/useStockMoves";
import { formatBRL } from "@/lib/domain/finance";
import { roundHalfUp } from "@/lib/domain/money";
import { allocateFreight, ENTRY_TYPE_LABEL, entryLineTotalCents, stockMoveErrorMessage, todayIsoBR, type EntryType } from "@/lib/domain/stockMoves";

type ManualType = Exclude<EntryType, "xml_purchase">;
interface Line { itemId: string; qty: number | null; unitCost: number | null; lot: string; expiry: string }
const emptyLine = (): Line => ({ itemId: "", qty: null, unitCost: null, lot: "", expiry: "" });
const NEW_SUPPLIER = "__new";

export function ManualEntryDialog({ clinicId, onClose }: { clinicId: string; onClose: () => void }) {
  const units = (useUnits(clinicId).data ?? []).filter((u) => u.is_active);
  const items = (useStockItems(clinicId).data ?? []).filter((i) => i.is_active);
  const suppliers = (useSuppliers(clinicId).data ?? []).filter((s) => s.is_active);
  const [unitId, setUnitId] = useState("");
  const unit = unitId || units.find((u) => u.is_primary)?.id || units[0]?.id || "";
  const [type, setType] = useState<ManualType>("purchase");
  const [supplier, setSupplier] = useState("");
  const [newName, setNewName] = useState("");
  const [newTax, setNewTax] = useState("");
  const [invoice, setInvoice] = useState("");
  const [issue, setIssue] = useState("");
  const [freight, setFreight] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useCreateEntry(clinicId);
  const today = todayIsoBR();
  const buys = type === "purchase";
  const setLine = (i: number, patch: Partial<Line>) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const item = (id: string) => items.find((x) => x.id === id);

  const totals = useMemo(() => {
    const base = lines.map((l) => entryLineTotalCents(l.qty ?? 0, l.unitCost === null ? null : roundHalfUp(l.unitCost * 100, 4)) ?? 0);
    const items = base.reduce((a, v) => a + v, 0);
    try { return { items, all: allocateFreight(base, buys ? freight ?? 0 : 0).reduce((a, v) => a + v, 0) }; } catch { return { items, all: items }; }
  }, [lines, freight, buys]);

  function submit() {
    const e: Record<string, string> = {};
    if (!unit) e.unit = "Escolha a unidade.";
    if (buys) {
      if (!invoice.trim()) e.invoice = "Informe o número da nota.";
      if (!supplier) e.supplier = "Escolha ou cadastre o fornecedor.";
      if (supplier === NEW_SUPPLIER && !newName.trim()) e.newName = "Informe o nome do fornecedor.";
    }
    if (type === "bonus" && notes.trim().length < 3) e.notes = "Informe a origem (quem doou ou bonificou).";
    if (issue && issue > today) e.issue = "A data não pode ser futura.";
    lines.forEach((l, i) => {
      const it = item(l.itemId);
      if (!it) { e[`item${i}`] = "Escolha o item."; return; }
      if (l.qty === null || !(l.qty > 0)) e[`qty${i}`] = "Informe a quantidade.";
      else if (!it.fractional && !Number.isInteger(l.qty)) e[`qty${i}`] = "Este item só entra em unidades inteiras.";
      if (l.unitCost === null || l.unitCost < 0 || (l.unitCost === 0 && type !== "bonus")) e[`cost${i}`] = type === "bonus" ? "Informe o custo (pode ser zero)." : "Informe o custo unitário.";
      if (it.lot_control && (!l.lot.trim() || !l.expiry)) e[`lot${i}`] = "Informe o lote e a validade.";
      else if (l.expiry && l.expiry < today) e[`lot${i}`] = "A validade informada já passou.";
    });
    setErrors(e);
    if (Object.keys(e).length > 0) return setError("Corrija os campos destacados.");
    setError(null);
    save.mutate({
      unitId: unit,
      header: {
        entryType: type, supplierId: supplier && supplier !== NEW_SUPPLIER ? supplier : null, supplierNew: supplier === NEW_SUPPLIER ? { name: newName.trim(), taxId: newTax.trim() } : null,
        invoiceNumber: buys ? invoice.trim() : undefined, issueDate: buys ? issue || undefined : undefined, freightCents: buys ? freight ?? 0 : 0, notes: notes.trim() || undefined,
      },
      lines: lines.map((l) => ({
        itemId: l.itemId, quantity: l.qty as number, lineTotalCents: entryLineTotalCents(l.qty as number, roundHalfUp((l.unitCost as number) * 100, 4)) as number,
        lotCode: l.lot.trim() || null, expiryDate: l.expiry || null, supplierCode: null, conversionFactor: 1,
      })),
    }, { onSuccess: onClose, onError: (err) => setError(stockMoveErrorMessage(err)) });
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title="Nova entrada" description="Saldo inicial, compra ou bonificação. A quantidade é na unidade de estoque do item; o custo médio é recalculado." onSubmit={submit} pending={save.isPending} error={error} submitLabel="Lançar entrada" wide>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Unidade" htmlFor="en-unit" error={errors.unit}>
          <NativeSelect id="en-unit" value={unit} onChange={(e) => setUnitId(e.target.value)}>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Tipo de entrada" htmlFor="en-type" hint={type === "initial_balance" ? "Uma vez por item e unidade (implantação)." : undefined}>
          <NativeSelect id="en-type" value={type} onChange={(e) => setType(e.target.value as ManualType)}>
            {(["initial_balance", "purchase", "bonus"] as ManualType[]).map((t) => <option key={t} value={t}>{ENTRY_TYPE_LABEL[t]}</option>)}
          </NativeSelect>
        </Field>
        {buys ? (
          <>
            <Field label="Fornecedor" htmlFor="en-sup" error={errors.supplier}>
              <NativeSelect id="en-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option value="">Selecione…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value={NEW_SUPPLIER}>+ Novo fornecedor…</option>
              </NativeSelect>
            </Field>
            <Field label="Número da nota" htmlFor="en-inv" error={errors.invoice}><Input id="en-inv" value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={40} /></Field>
            {supplier === NEW_SUPPLIER ? (
              <>
                <Field label="Nome do fornecedor" htmlFor="en-nname" error={errors.newName}><Input id="en-nname" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={160} /></Field>
                <Field label="CNPJ (opcional)" htmlFor="en-ntax"><Input id="en-ntax" inputMode="numeric" value={newTax} onChange={(e) => setNewTax(e.target.value)} maxLength={18} /></Field>
              </>
            ) : null}
            <Field label="Data da nota" htmlFor="en-issue" error={errors.issue}><Input id="en-issue" type="date" value={issue} max={today} onChange={(e) => setIssue(e.target.value)} /></Field>
            <Field label="Frete (R$)" htmlFor="en-freight" hint="Rateado pelo valor dos itens."><CentsInput id="en-freight" value={freight} onChange={setFreight} /></Field>
          </>
        ) : null}
        {type === "bonus" ? <Field label="Origem da bonificação ou doação" htmlFor="en-notes" error={errors.notes} className="sm:col-span-2"><Input id="en-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field> : null}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Itens</p>
        {lines.map((l, i) => {
          const it = item(l.itemId);
          return (
            <div key={i} className="grid min-w-0 grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_6rem_8rem_minmax(0,1fr)_9rem_auto] lg:items-start">
              <Field label="Item" htmlFor={`en-i-${i}`} error={errors[`item${i}`]} className="sm:col-span-2 lg:col-span-1">
                <NativeSelect id={`en-i-${i}`} value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}>
                  <option value="">Selecione…</option>
                  {items.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.stock_unit})</option>)}
                </NativeSelect>
              </Field>
              <Field label={`Qtd.${it ? ` (${it.stock_unit})` : ""}`} htmlFor={`en-q-${i}`} error={errors[`qty${i}`]}><DecimalInput id={`en-q-${i}`} value={l.qty} onChange={(v) => setLine(i, { qty: v })} maxDecimals={3} /></Field>
              <Field label="Custo unitário (R$)" htmlFor={`en-c-${i}`} error={errors[`cost${i}`]}><DecimalInput id={`en-c-${i}`} value={l.unitCost} onChange={(v) => setLine(i, { unitCost: v })} maxDecimals={4} /></Field>
              <Field label={it?.lot_control ? "Lote (obrigatório)" : "Lote"} htmlFor={`en-l-${i}`} error={errors[`lot${i}`]}><Input id={`en-l-${i}`} value={l.lot} onChange={(e) => setLine(i, { lot: e.target.value })} maxLength={60} /></Field>
              <Field label={it?.lot_control ? "Validade (obrigatória)" : "Validade"} htmlFor={`en-e-${i}`}><Input id={`en-e-${i}`} type="date" value={l.expiry} min={today} onChange={(e) => setLine(i, { expiry: e.target.value })} /></Field>
              <div className="flex items-end justify-end lg:pt-6">
                <Button type="button" variant="ghost" size="icon" aria-label={`Remover item ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((c) => c.filter((_, j) => j !== i))}><Trash2 aria-hidden /></Button>
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((c) => [...c, emptyLine()])}><Plus aria-hidden /> Adicionar item</Button>
          <p className="text-sm">Total da entrada: <strong className="tabular-nums">{formatBRL(totals.all)}</strong>{buys && (freight ?? 0) > 0 ? <span className="text-muted-foreground"> (itens {formatBRL(totals.items)} + frete)</span> : null}</p>
        </div>
      </div>
    </FormDialog>
  );
}
