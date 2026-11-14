// Nova saída (escopo-v1 §8.2/8.3): consumo interno, perda/quebra/vencimento e uso por paciente. Lote sugerido pela validade (vence primeiro,
// sai primeiro) e trocável; lote vencido só sai como perda por vencimento, com confirmação; uso fracionado por unidade aberta (individual por paciente).
// O servidor revalida tudo (as mesmas regras de src/lib/domain/stockMoves.ts).
import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { CheckField, DecimalInput, Field, FormDialog, NativeSelect } from "@/components/fin/FinUi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStockItems, useUnits } from "@/hooks/useFin";
import { useBalances, useRegisterExit, useStockLots, useStockPatients } from "@/hooks/useStockMoves";
import { formatBRL } from "@/lib/domain/finance";
import {
  EXIT_TYPE_LABEL, exitValueCents, formatQty, LOSS_KIND_LABEL, pickLotsFefo, StockRuleException, stockMoveErrorMessage, todayIsoBR, validateExit,
  type ExitType, type LossKind,
} from "@/lib/domain/stockMoves";

const br = (iso: string | null) =>
  !iso ? "sem validade" : iso.length > 10 ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : iso.split("-").reverse().join("/");

export function ExitDialog({ clinicId, onClose }: { clinicId: string; onClose: () => void }) {
  const units = (useUnits(clinicId).data ?? []).filter((u) => u.is_active);
  const [unitId, setUnitId] = useState("");
  const unit = unitId || units.find((u) => u.is_primary)?.id || units[0]?.id || "";
  const [itemId, setItemId] = useState("");
  const [type, setType] = useState<ExitType>("sector");
  const [qty, setQty] = useState<number | null>(null);
  const [lotId, setLotId] = useState("");
  const [openUnitId, setOpenUnitId] = useState("");
  const [reason, setReason] = useState("");
  const [purpose, setPurpose] = useState("");
  const [lossKind, setLossKind] = useState<LossKind | "">("");
  const [confirmExpired, setConfirmExpired] = useState(false);
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ReturnType<typeof validateExit>>({});
  const today = todayIsoBR();

  const balances = useBalances(clinicId, { unitId: unit || null, onlyPositive: true }, Boolean(unit));
  const items = useStockItems(clinicId).data ?? [];
  const balance = (balances.data ?? []).find((b) => b.item_id === itemId) ?? null;
  const item = items.find((i) => i.id === itemId) ?? null;
  const lots = useStockLots(clinicId, unit || null, itemId || null).data;
  const needsPatient = type === "appointment" || Boolean(item?.individual_use && item?.fractional && !openUnitId && type !== "loss");
  const found = useStockPatients(clinicId, search.trim(), needsPatient && !patient).data ?? [];
  const save = useRegisterExit(clinicId);

  const expiryLoss = type === "loss" && lossKind === "expiry";
  const selectedLot = lots?.lots.find((l) => l.lot_id === lotId);
  const openUnits = (lots?.open_units ?? []).filter((o) => !o.expired || expiryLoss || type === "loss");

  // Pré-visualização do lote sugerido e do custo (quem decide é o servidor).
  const preview = useMemo(() => {
    if (!lots || !qty || qty <= 0 || !item) return null;
    if (item.fractional && (openUnitId || qty < 1)) {
      const ou = lots.open_units.find((o) => o.open_unit_id === openUnitId);
      return { text: ou ? `Dose da unidade aberta (lote ${ou.lot_code}).` : "Abre uma nova unidade (do lote que vence primeiro) e tira a dose dela.", error: null as string | null };
    }
    try {
      const alloc = pickLotsFefo(lots.lots.map((l) => ({ lotId: l.lot_id, lotCode: l.lot_code, expiryDate: l.expiry_date, qty: l.qty, available: l.available })), qty, today, { expiryLoss, chosenLotId: lotId || null });
      return { text: `Sai de: ${alloc.map((a) => `${a.lotCode} (${formatQty(a.qty)})`).join(", ")}.`, error: null };
    } catch (e) {
      return { text: "", error: e instanceof StockRuleException ? stockMoveErrorMessage({ message: e.code }) : null };
    }
  }, [lots, qty, item, openUnitId, lotId, expiryLoss, today]);
  const cost = qty && qty > 0 && lots?.avg_cost_cents != null ? exitValueCents(qty, lots.avg_cost_cents) : null;

  function submit() {
    const found2 = validateExit(
      { type, qty, reason, purpose, lossKind, patientId: patient?.id ?? "", confirmExpired },
      { fractional: Boolean(item?.fractional), individualUse: Boolean(item?.individual_use), selectedLotExpired: Boolean(selectedLot?.expired) || expiryLoss },
    );
    if (!itemId) found2.qty = found2.qty ?? "Escolha o item.";
    if (needsPatient && !patient) found2.patient = "Escolha o paciente.";
    setErrors(found2);
    if (Object.keys(found2).length > 0 || !itemId || !qty) return setError("Corrija os campos destacados.");
    setError(null);
    save.mutate({
      unitId: unit, itemId, type, quantity: qty, reason: reason.trim(), purpose: purpose.trim(), lossKind, patientId: patient?.id, lotId: lotId || undefined,
      openUnitId: openUnitId || undefined, confirmExpired: expiryLoss ? true : confirmExpired,
    }, { onSuccess: onClose, onError: (e) => setError(stockMoveErrorMessage(e)) });
  }

  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title="Nova saída" description="Consumo interno, perda, quebra, vencimento ou uso por paciente. O custo é o custo médio do momento." onSubmit={submit} pending={save.isPending} error={error} submitLabel="Registrar saída" wide>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Unidade" htmlFor="ex-unit">
          <NativeSelect id="ex-unit" value={unit} onChange={(e) => { setUnitId(e.target.value); setItemId(""); setLotId(""); setOpenUnitId(""); }}>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Tipo de saída" htmlFor="ex-type">
          <NativeSelect id="ex-type" value={type} onChange={(e) => { setType(e.target.value as ExitType); setConfirmExpired(false); setLotId(""); setOpenUnitId(""); }}>
            {(Object.keys(EXIT_TYPE_LABEL) as ExitType[]).map((t) => <option key={t} value={t}>{EXIT_TYPE_LABEL[t]}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Item" htmlFor="ex-item" error={errors.qty && !itemId ? errors.qty : undefined} className="sm:col-span-2">
          <NativeSelect id="ex-item" value={itemId} onChange={(e) => { setItemId(e.target.value); setLotId(""); setOpenUnitId(""); setQty(null); }}>
            <option value="">Selecione…</option>
            {(balances.data ?? []).map((b) => <option key={b.item_id} value={b.item_id}>{b.item_name} — saldo {formatQty(b.qty_on_hand)} {b.stock_unit}</option>)}
          </NativeSelect>
        </Field>
      </div>

      {type === "loss" ? (
        <Field label="Tipo de perda (obrigatório)" htmlFor="ex-kind" error={errors.lossKind}>
          <NativeSelect id="ex-kind" value={lossKind} onChange={(e) => { setLossKind(e.target.value as LossKind | ""); setLotId(""); }}>
            <option value="">Selecione…</option>
            {(Object.keys(LOSS_KIND_LABEL) as LossKind[]).map((k) => <option key={k} value={k}>{LOSS_KIND_LABEL[k]}</option>)}
          </NativeSelect>
        </Field>
      ) : null}

      {itemId ? (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label={`Quantidade (${balance?.stock_unit ?? "un"})`} htmlFor="ex-qty" error={errors.qty && itemId ? errors.qty : undefined} hint={item?.fractional ? "Item de uso fracionado: aceita até 3 casas (ex.: 0,25)." : undefined}>
            <DecimalInput id="ex-qty" value={qty} onChange={setQty} maxDecimals={3} />
          </Field>
          <Field label="Lote" htmlFor="ex-lot" hint="Padrão: o que vence primeiro. Você pode trocar.">
            <NativeSelect id="ex-lot" value={lotId} onChange={(e) => setLotId(e.target.value)} disabled={Boolean(openUnitId)}>
              <option value="">Automático (vence primeiro)</option>
              {(lots?.lots ?? []).map((l) => <option key={l.lot_id} value={l.lot_id}>{l.lot_code} · vence {br(l.expiry_date)} · {formatQty(l.available)} disp.{l.expired ? " · VENCIDO" : ""}</option>)}
            </NativeSelect>
          </Field>
        </div>
      ) : null}

      {item?.fractional ? (
        <Field label="Unidade aberta" htmlFor="ex-open" hint={item.individual_use ? "Uso individual: a unidade aberta fica ligada a um único paciente." : "Escolha uma unidade já aberta ou abra uma nova."}>
          <NativeSelect id="ex-open" value={openUnitId} onChange={(e) => setOpenUnitId(e.target.value)}>
            <option value="">Abrir nova unidade</option>
            {openUnits.map((o) => <option key={o.open_unit_id} value={o.open_unit_id}>{o.patient_name ? `${o.patient_name} · ` : ""}resta {formatQty(o.qty_remaining)} · vence {br(o.expires_on)}{o.expired ? " · VENCIDA" : ""}</option>)}
          </NativeSelect>
        </Field>
      ) : null}

      {needsPatient ? (
        <Field label="Paciente" htmlFor="ex-patient" error={errors.patient}>
          {patient ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="min-w-0 truncate font-medium">{patient.name}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPatient(null)}>Trocar</Button>
            </div>
          ) : (
            <div className="space-y-1">
              <Input id="ex-patient" placeholder="Buscar pelo nome" value={search} onChange={(e) => setSearch(e.target.value)} />
              <ul className="max-h-40 overflow-auto rounded-md border" aria-label="Pacientes encontrados">
                {found.length === 0 ? <li className="px-3 py-2 text-xs text-muted-foreground">Nenhum paciente encontrado.</li> : found.map((p) => (
                  <li key={p.patient_id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setPatient({ id: p.patient_id, name: p.full_name })}>{p.full_name}</button></li>
                ))}
              </ul>
            </div>
          )}
        </Field>
      ) : null}

      {type === "sector" ? <Field label="Setor ou finalidade" htmlFor="ex-purpose" error={errors.purpose}><Input id="ex-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={120} placeholder="Esterilização, uso geral da sala…" /></Field> : null}
      {type === "sector" || type === "loss" ? <Field label="Motivo" htmlFor="ex-reason" error={errors.reason}><Input id="ex-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field> : null}

      {expiryLoss ? (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="flex items-start gap-1.5 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Perda por vencimento só vale para lote vencido. Confira o lote antes de confirmar.</p>
          <CheckField id="ex-confirm" label="Confirmo que o lote está vencido" checked={confirmExpired} onChange={setConfirmExpired} />
          {errors.confirm ? <p className="text-xs font-medium text-destructive" role="alert">{errors.confirm}</p> : null}
        </div>
      ) : null}

      {preview?.error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="status">{preview.error}</p> : null}
      {preview?.text ? <p className="text-sm text-muted-foreground" role="status">{preview.text}</p> : null}
      {cost !== null ? <p className="text-sm">Custo da saída: <strong className="tabular-nums">{formatBRL(cost)}</strong> <span className="text-muted-foreground">(custo médio do momento)</span></p> : null}
    </FormDialog>
  );
}
