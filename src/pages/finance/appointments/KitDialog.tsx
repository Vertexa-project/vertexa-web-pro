// Confirmar o kit ao REALIZAR o atendimento (escopo-v1 §8.5) ou CORRIGIR a baixa depois de confirmada: kit pré-preenchido na unidade de consumo, lote sugerido
// (vence primeiro, sai primeiro) e trocável, quantidade editável, item removido ou adicionado. Sem saldo, o atendimento é salvo mesmo assim («consumo sem saldo»).
import { useRef, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";

import { DecimalInput, Field, FormDialog, NativeSelect } from "@/components/fin/FinUi";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useApptKit, useCompleteAppointment, useCorrectAppointment } from "@/hooks/useFinAppointments";
import type { ApptDetail, KitView } from "@/lib/api/finAppointments";
import { apptErrorMessage, planKitLine, validateKit, type KitLineDraft, type KitLineInfo } from "@/lib/domain/finAppointments";
import { formatBRL } from "@/lib/domain/finance";
import { formatQty } from "@/lib/domain/stockMoves";

const br = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "sem validade");
interface Row extends KitLineDraft { uid: number }

export function KitDialog({ appt, mode, onClose, onDone }: { appt: ApptDetail; mode: "complete" | "correct"; onClose: () => void; onDone?: (r: { hasShortfall: boolean }) => void }) {
  const q = useApptKit(appt.id);
  if (q.isLoading || q.isError || !q.data) {
    return (
      <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
        <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-xl">
          <DialogHeader><DialogTitle>{mode === "complete" ? "Realizar atendimento" : "Corrigir kit"}</DialogTitle></DialogHeader>
          <DialogBody>{q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : <LoadingState />}</DialogBody>
        </DialogContent>
      </Dialog>
    );
  }
  return <KitEditor appt={appt} kit={q.data} mode={mode} onClose={onClose} onDone={onDone} />;
}

function KitEditor({ appt, kit, mode, onClose, onDone }: { appt: ApptDetail; kit: KitView; mode: "complete" | "correct"; onClose: () => void; onDone?: (r: { hasShortfall: boolean }) => void }) {
  const uid = useRef(0);
  const next = () => ++uid.current;
  const [rows, setRows] = useState<Row[]>(() => kit.lines.map((l) => ({ uid: next(), itemId: l.item_id, quantity: l.qty, lotId: "" })));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [reasonError, setReasonError] = useState<string | null>(null);
  const complete = useCompleteAppointment();
  const correct = useCorrectAppointment();
  const pending = complete.isPending || correct.isPending;

  // no «corrigir», o estorno da rodada anterior devolve o que foi baixado: o saldo para conferir é saldo + o que volta
  const returning = (itemId: string) => (mode === "correct" ? appt.materials.filter((m) => m.status === "active" && m.item_id === itemId).reduce((a, m) => a + m.applied_qty, 0) : 0);
  const infoOf = (itemId: string): KitLineInfo | undefined => {
    const l = kit.lines.find((x) => x.item_id === itemId);
    if (l) return { itemId, fractional: l.fractional, factor: l.factor, balance: l.balance + returning(itemId), avgCostCents: l.avg_cost_cents };
    const c = kit.catalog.find((x) => x.id === itemId);
    return c ? { itemId, fractional: c.fractional, factor: c.factor, balance: c.balance + returning(itemId), avgCostCents: null } : undefined;
  };
  const lineOf = (itemId: string) => kit.lines.find((x) => x.item_id === itemId);
  const setRow = (u: number, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.uid === u ? { ...r, ...patch } : r)));
  const used = new Set(rows.map((r) => r.itemId));

  const plans = rows.map((r) => { const i = infoOf(r.itemId); return r.itemId && r.quantity && r.quantity > 0 && i ? planKitLine(r.quantity, i) : null; });
  const estimated = kit.can_cost && plans.every((p) => p === null || p.estimatedCostCents !== null) ? plans.reduce((a, p) => a + (p?.estimatedCostCents ?? 0), 0) : null;
  const anyShort = plans.some((p) => p && !p.enough);

  function submit() {
    const errs = validateKit(rows, infoOf);
    setErrors(errs);
    if (mode === "correct" && note.trim().length < 3) { setReasonError("Informe o motivo da correção."); return; }
    setReasonError(null);
    if (Object.keys(errs).length > 0) { setError(null); return; }
    setError(null);
    const lines = rows.map((r) => ({ itemId: r.itemId, quantity: r.quantity as number, lotId: r.lotId || null }));
    const done = (r: { has_shortfall: boolean }) => { onDone?.({ hasShortfall: r.has_shortfall }); onClose(); };
    const onError = (e: unknown) => setError(apptErrorMessage(e));
    if (mode === "complete") complete.mutate({ id: appt.id, lines, note: note.trim() || undefined }, { onSuccess: done, onError });
    else correct.mutate({ id: appt.id, lines, reason: note.trim() }, { onSuccess: done, onError });
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} wide pending={pending} error={error} onSubmit={submit}
      title={mode === "complete" ? "Realizar atendimento — confirmar o kit" : "Corrigir kit do atendimento"}
      description={mode === "complete"
        ? `${appt.service_name} · ${appt.patient_name ?? "paciente"}. Confira lote e quantidades: ao confirmar, o estoque baixa e o custo do material fica no atendimento.`
        : "A baixa anterior é estornada e a nova é lançada. Tudo fica no Histórico, com o motivo."}
      submitLabel={mode === "complete" ? "Confirmar e realizar" : "Salvar correção"}>
      {rows.length === 0 ? <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm" role="note">{mode === "complete" ? "Este serviço não tem kit: o atendimento será realizado sem baixa de estoque. Você pode adicionar itens usados." : "Sem itens: a baixa anterior será apenas estornada."}</p> : null}
      <ul className="min-w-0 space-y-3" aria-label="Itens do kit">
        {rows.map((r, idx) => {
          const l = lineOf(r.itemId);
          const info = infoOf(r.itemId);
          const plan = plans[idx];
          const unitLabel = l?.consumption_unit ?? kit.catalog.find((c) => c.id === r.itemId)?.consumption_unit ?? "un";
          return (
            <li key={r.uid} className="min-w-0 space-y-2 rounded-lg border p-3">
              <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_auto]">
                <Field label="Item" htmlFor={`kit-item-${r.uid}`} error={errors[idx]}>
                  {l?.source === "kit" || (mode === "correct" && l) ? (
                    <Input id={`kit-item-${r.uid}`} value={l?.name ?? ""} readOnly />
                  ) : (
                    <NativeSelect id={`kit-item-${r.uid}`} value={r.itemId} onChange={(e) => setRow(r.uid, { itemId: e.target.value, lotId: "" })}>
                      <option value="">Selecione…</option>
                      {kit.catalog.filter((c) => c.id === r.itemId || !used.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </NativeSelect>
                  )}
                </Field>
                <Field label={`Quantidade (${unitLabel})`} htmlFor={`kit-qty-${r.uid}`} hint={l && l.planned_qty > 0 ? `Kit: ${formatQty(l.planned_qty)}` : undefined}>
                  <DecimalInput id={`kit-qty-${r.uid}`} value={r.quantity} onChange={(v) => setRow(r.uid, { quantity: v })} maxDecimals={3} />
                </Field>
                <Field label="Lote" htmlFor={`kit-lot-${r.uid}`} hint={l && l.lots.length === 0 ? "Sem lote com saldo." : "Padrão: o que vence primeiro. Você pode trocar."}>
                  <NativeSelect id={`kit-lot-${r.uid}`} value={r.lotId} onChange={(e) => setRow(r.uid, { lotId: e.target.value })} disabled={!l || l.lots.length === 0}>
                    <option value="">Automático (vence primeiro)</option>
                    {(l?.lots ?? []).map((x) => <option key={x.lot_id} value={x.lot_id} disabled={x.expired}>{x.lot_code} · vence {br(x.expiry_date)} · {formatQty(x.available)} disp.{x.expired ? " · VENCIDO" : ""}</option>)}
                  </NativeSelect>
                </Field>
                <div className="flex items-end"><Button type="button" variant="ghost" size="icon" aria-label={`Remover ${l?.name ?? "item"} do kit`} onClick={() => setRows((cur) => cur.filter((x) => x.uid !== r.uid))}><Trash2 aria-hidden /></Button></div>
              </div>
              {info && plan ? (
                <p className="text-xs text-muted-foreground" role="status">
                  Saldo na unidade: <strong className="tabular-nums">{formatQty(info.balance)}</strong> {l?.stock_unit ?? ""} · sai {formatQty(plan.stockQty)} {l?.stock_unit ?? ""} do estoque
                  {plan.estimatedCostCents !== null ? <> · custo <strong className="tabular-nums">{formatBRL(plan.estimatedCostCents)}</strong></> : null}
                </p>
              ) : null}
              {plan && !plan.enough ? (
                <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" role="alert">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>Faltam {formatQty(plan.shortQty)} {l?.stock_unit ?? ""} no estoque. O atendimento é salvo mesmo assim: essa parte fica como «consumo sem saldo» e o gestor é avisado.</span>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => setRows((cur) => [...cur, { uid: next(), itemId: "", quantity: null, lotId: "" }])} disabled={kit.catalog.length === 0}><Plus aria-hidden /> Adicionar item</Button>
      {anyShort ? <p className="text-xs text-muted-foreground">O registro clínico nunca é bloqueado pelo estoque.</p> : null}
      {estimated !== null ? <p className="text-sm">Custo estimado do material: <strong className="tabular-nums">{formatBRL(estimated)}</strong> <span className="text-muted-foreground">(custo médio do momento)</span></p> : null}
      <Field label={mode === "complete" ? "Observação (opcional)" : "Motivo da correção"} htmlFor="kit-note" error={reasonError}>
        <Input id="kit-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={mode === "complete" ? 500 : 200} />
      </Field>
    </FormDialog>
  );
}
