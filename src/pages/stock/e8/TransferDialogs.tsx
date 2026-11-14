// Transferência entre unidades: diálogos de envio, conferência no recebimento (divergência com motivo) e cancelamento (Entrega 8).
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { DecimalInput, Field, FormDialog, NativeSelect } from "@/components/fin/FinUi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBalances } from "@/hooks/useStockMoves";
import { useReceiveTransfer, useSendTransfer } from "@/hooks/useStockE8";
import type { TransferRow } from "@/lib/api/stockE8";
import { e8ErrorMessage, moneyOrZero, receiveDraftFor, validateReceive, type ReceiveDraft } from "@/lib/domain/stockE8";
import { formatQty } from "@/lib/domain/stockMoves";

interface UnitOpt { id: string; name: string }
interface DraftLine { key: number; itemId: string; qty: number | null }

export function SendTransferDialog({ clinicId, units, defaultFrom, onClose }: { clinicId: string; units: UnitOpt[]; defaultFrom: string; onClose: () => void }) {
  const [from, setFrom] = useState(defaultFrom || units[0]?.id || "");
  const [to, setTo] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ key: 1, itemId: "", qty: null }]);
  const [errors, setErrors] = useState<{ to?: string; lines?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const send = useSendTransfer(clinicId);
  const bal = useBalances(clinicId, { unitId: from || null, onlyPositive: true }, Boolean(from));
  const options = useMemo(() => (bal.data ?? []).filter((b) => b.qty_on_hand - b.open_qty >= 1), [bal.data]);
  const byItem = useMemo(() => new Map(options.map((b) => [b.item_id, b])), [options]);

  const submit = () => {
    const e: typeof errors = {};
    if (!to) e.to = "Escolha a unidade de destino.";
    if (to && to === from) e.to = "Origem e destino precisam ser diferentes.";
    const used = new Set<string>();
    for (const l of lines) {
      const b = byItem.get(l.itemId);
      if (!b || l.qty === null || l.qty <= 0) { e.lines = "Escolha o item e a quantidade em todas as linhas."; break; }
      if (l.qty !== Math.trunc(l.qty)) { e.lines = `${b.item_name}: só unidades inteiras (dose aberta não se transfere).`; break; }
      if (l.qty > b.qty_on_hand - b.open_qty) { e.lines = `${b.item_name}: saldo disponível ${formatQty(b.qty_on_hand - b.open_qty)}.`; break; }
      if (used.has(l.itemId)) { e.lines = `${b.item_name} aparece duas vezes: some as quantidades numa só linha.`; break; }
      used.add(l.itemId);
    }
    setErrors(e); setError(null);
    if (e.to || e.lines) return;
    send.mutate({ from, to, notes, lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.qty as number })) }, { onSuccess: onClose, onError: (err) => setError(e8ErrorMessage(err)) });
  };
  const set = (key: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title="Nova transferência" wide submitLabel="Enviar transferência" pending={send.isPending} error={error} onSubmit={submit}
      description="O que sair da origem fica «em trânsito» até a unidade de destino conferir e receber. O custo médio da origem é preservado.">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Unidade de origem" htmlFor="tr-from">
          <NativeSelect id="tr-from" value={from} onChange={(e) => { setFrom(e.target.value); setLines([{ key: 1, itemId: "", qty: null }]); }}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect>
        </Field>
        <Field label="Unidade de destino" htmlFor="tr-to" error={errors.to}>
          <NativeSelect id="tr-to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Escolha…</option>{units.filter((u) => u.id !== from).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect>
        </Field>
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium">Itens</p>
        {lines.map((l, i) => {
          const b = byItem.get(l.itemId);
          return (
            <div key={l.key} className="flex min-w-0 flex-wrap items-end gap-2 rounded-md border p-2">
              <Field label={`Item ${i + 1}`} htmlFor={`tr-item-${l.key}`} className="min-w-[12rem] flex-1">
                <NativeSelect id={`tr-item-${l.key}`} value={l.itemId} onChange={(e) => set(l.key, { itemId: e.target.value })}>
                  <option value="">{bal.isLoading ? "Carregando…" : "Escolha…"}</option>
                  {options.map((o) => <option key={o.item_id} value={o.item_id}>{o.item_name} — disp. {formatQty(o.qty_on_hand - o.open_qty)} {o.stock_unit}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Quantidade" htmlFor={`tr-qty-${l.key}`} className="w-28" hint={b ? b.stock_unit : undefined}>
                <DecimalInput id={`tr-qty-${l.key}`} value={l.qty} onChange={(v) => set(l.key, { qty: v })} maxDecimals={0} />
              </Field>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remover item ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 aria-hidden /></Button>
            </div>
          );
        })}
        {errors.lines ? <p className="text-xs font-medium text-destructive" role="alert">{errors.lines}</p> : null}
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { key: Math.max(...ls.map((x) => x.key)) + 1, itemId: "", qty: null }])}><Plus aria-hidden /> Adicionar item</Button>
        <p className="text-xs text-muted-foreground">O lote sai pelo vencimento mais próximo (FEFO); lote vencido não é transferido.</p>
      </div>
      <Field label="Observação (opcional)" htmlFor="tr-notes"><Input id="tr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} /></Field>
    </FormDialog>
  );
}

export function ReceiveTransferDialog({ transfer, onClose }: { transfer: TransferRow; onClose: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, ReceiveDraft>>(() => Object.fromEntries(transfer.lines.map((l) => [l.line_id, receiveDraftFor(l)])));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const receive = useReceiveTransfer();
  const patch = (id: string, p: Partial<ReceiveDraft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...p } }));
  const results = transfer.lines.map((l) => ({ l, v: validateReceive(l, drafts[l.line_id]) }));

  const submit = () => {
    setShowErrors(true); setError(null);
    if (results.some((r) => r.v.error)) return;
    receive.mutate({
      transferId: transfer.id, note,
      lines: results.map((r) => ({ lineId: r.l.line_id, quantity: r.v.qty as number, lotCode: drafts[r.l.line_id].lotCode.trim(), expiryDate: drafts[r.l.line_id].expiry || null, reason: drafts[r.l.line_id].reason })),
    }, { onSuccess: onClose, onError: (e) => setError(e8ErrorMessage(e)) });
  };

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={`Receber transferência nº ${transfer.number}`} wide submitLabel="Confirmar recebimento" pending={receive.isPending} error={error} onSubmit={submit}
      description={`De ${transfer.from_unit_name} para ${transfer.to_unit_name}. Confira cada linha: quantidade a menos ou lote diferente exige o motivo; a diferença vira perda da origem.`}>
      <div className="min-w-0 space-y-3">
        {results.map(({ l, v }, i) => {
          const d = drafts[l.line_id];
          return (
            <fieldset key={l.line_id} className="min-w-0 space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">{l.item_name}</legend>
              <p className="text-xs text-muted-foreground">Enviado: {formatQty(l.qty_sent)} {l.stock_unit} · lote {l.lot_code}{l.expiry_date ? ` · val. ${l.expiry_date.split("-").reverse().join("/")}` : ""} · {moneyOrZero(l.total_cost_cents)}</p>
              <div className="flex min-w-0 flex-wrap items-end gap-2">
                <Field label="Quantidade recebida" htmlFor={`rc-qty-${i}`} className="w-36" error={showErrors && v.error && !v.error.startsWith("Divergência") ? v.error : null}>
                  <Input id={`rc-qty-${i}`} inputMode="decimal" value={d.qty} onChange={(e) => patch(l.line_id, { qty: e.target.value })} />
                </Field>
                <Field label="Lote" htmlFor={`rc-lot-${i}`} className="w-36"><Input id={`rc-lot-${i}`} value={d.lotCode} onChange={(e) => patch(l.line_id, { lotCode: e.target.value })} maxLength={40} /></Field>
                <Field label="Validade" htmlFor={`rc-exp-${i}`} className="w-40"><Input id={`rc-exp-${i}`} type="date" value={d.expiry} onChange={(e) => patch(l.line_id, { expiry: e.target.value })} /></Field>
              </div>
              {v.diverges ? (
                <Field label="Motivo da divergência" htmlFor={`rc-why-${i}`} error={showErrors && v.error?.startsWith("Divergência") ? v.error : null}>
                  <Input id={`rc-why-${i}`} value={d.reason} onChange={(e) => patch(l.line_id, { reason: e.target.value })} maxLength={200} />
                </Field>
              ) : null}
            </fieldset>
          );
        })}
      </div>
      <Field label="Observação do recebimento (opcional)" htmlFor="rc-note"><Input id="rc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
    </FormDialog>
  );
}
