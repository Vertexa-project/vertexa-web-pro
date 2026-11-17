// Diálogos da medicação (A3): tratamento, ajuste de dose, aplicação feita e entrega.
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { StockPicker } from "./StockPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMedMutations } from "@/hooks/useMedication";
import {
  DEFAULT_MEDICATION, formatMg, medErrorMessage, NO_STOCK, parseMg, PLACE_LABEL, splitStock, stockValue, validateApplication, validateDelivery, validateTreatment, WEEKDAYS,
  type MedPlace, type MedTreatment,
} from "@/lib/domain/medication";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import { captureException } from "@/lib/observability/sentry";

interface Base { open: boolean; onOpenChange: (o: boolean) => void; patientId: string }

function Shell({ open, onOpenChange, busy, title, description, error, onSave, saveLabel, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; title: string; description: string; error: string | null; onSave: () => void; saveLabel: string; children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {children}
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={onSave} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}{saveLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlaceSelect({ id, value, onChange }: { id: string; value: MedPlace; onChange: (p: MedPlace) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as MedPlace)}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="home">{PLACE_LABEL.home}</SelectItem>
        <SelectItem value="clinic">{PLACE_LABEL.clinic}</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function TreatmentDialog({ open, onOpenChange, patientId, existing }: Base & { existing: MedTreatment | null }) {
  const { save } = useMedMutations(patientId);
  const [medication, setMedication] = useState(DEFAULT_MEDICATION);
  const [startedOn, setStartedOn] = useState("");
  const [dose, setDose] = useState("");
  const [weekday, setWeekday] = useState<number | null>(null);
  const [where, setWhere] = useState<MedPlace>("home");
  const [notes, setNotes] = useState("");
  const [stock, setStock] = useState(NO_STOCK);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMedication(existing?.medication ?? DEFAULT_MEDICATION);
    setStartedOn(existing?.started_on ?? todayIsoBR());
    setDose(existing ? String(existing.dose_mg).replace(".", ",") : "");
    setWeekday(existing?.weekday ?? null);
    setWhere(existing?.applied_where ?? "home");
    setNotes(existing?.notes ?? "");
    setStock(stockValue(existing?.stock_item_id ?? null, existing?.stock_unit_id ?? null));
    setError(null);
  }, [open, existing]);

  function submit() {
    const invalid = validateTreatment({ medication, startedOn, doseMg: dose, weekday, where, notes, isNew: !existing }, todayIsoBR());
    if (invalid) return setError(invalid);
    const s = splitStock(stock);
    setError(null);
    save.mutate(
      { patientId, id: existing?.id ?? null, medication: medication.trim() || DEFAULT_MEDICATION, startedOn, doseMg: parseMg(dose), weekday: weekday as number, where, notes: notes.trim(), stockItem: s.item, stockUnit: s.unit },
      { onSuccess: () => onOpenChange(false), onError: (e) => { captureException(e, { source: "medication", scope: "save" }); setError(medErrorMessage(e)); } },
    );
  }

  return (
    <Shell open={open} onOpenChange={onOpenChange} busy={save.isPending} error={error} onSave={submit} saveLabel="Salvar tratamento"
      title={existing ? "Editar tratamento" : "Novo tratamento"}
      description={existing ? "Muda o dia, o local e a observação. Para mudar a dose, use Ajustar dose (fica no histórico)." : "Cadastra a medicação, a dose e o dia da semana da aplicação."}>
      <div className="space-y-2">
        <Label htmlFor="med-name">Medicação</Label>
        <Input id="med-name" value={medication} maxLength={80} onChange={(e) => setMedication(e.target.value)} placeholder={DEFAULT_MEDICATION} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="med-start">Data de início</Label>
          <Input id="med-start" type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
        </div>
        {!existing ? (
          <div className="space-y-2">
            <Label htmlFor="med-dose">Dose (mg)</Label>
            <Input id="med-dose" inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="Ex.: 2,5" />
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Dose atual</Label>
            <p className="flex h-10 items-center text-sm font-medium text-foreground">{formatMg(existing.dose_mg)}</p>
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="med-weekday">Dia da aplicação</Label>
          <Select value={weekday === null ? undefined : String(weekday)} onValueChange={(v) => setWeekday(Number(v))}>
            <SelectTrigger id="med-weekday" className="w-full"><SelectValue placeholder="Escolha o dia" /></SelectTrigger>
            <SelectContent>{WEEKDAYS.map((w, i) => <SelectItem key={w} value={String(i)}>{w}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="med-where">Onde aplica</Label>
          <PlaceSelect id="med-where" value={where} onChange={setWhere} />
        </div>
      </div>
      <StockPicker id="med-stock" patientId={patientId} value={stock} onChange={setStock} label="Item do estoque (opcional)" hint="Se escolher, o item já vem marcado ao registrar a aplicação na clínica ou a entrega." />
      <div className="space-y-2">
        <Label htmlFor="med-notes">Observação</Label>
        <Textarea id="med-notes" value={notes} maxLength={500} rows={3} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Shell>
  );
}

export function DoseDialog({ open, onOpenChange, patientId, treatment }: Base & { treatment: MedTreatment }) {
  const { adjust } = useMedMutations(patientId);
  const [dose, setDose] = useState("");
  const [on, setOn] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setDose(""); setOn(todayIsoBR()); setNote(""); setError(null); } }, [open]);

  function submit() {
    const mg = parseMg(dose);
    if (mg === null) return setError("Informe a nova dose em mg (ex.: 5).");
    if (!on) return setError("Informe a data em que a nova dose vale.");
    setError(null);
    adjust.mutate({ treatmentId: treatment.id, doseMg: mg, effectiveOn: on, note: note.trim() }, {
      onSuccess: () => onOpenChange(false),
      onError: (e) => { captureException(e, { source: "medication", scope: "dose" }); setError(medErrorMessage(e)); },
    });
  }
  return (
    <Shell open={open} onOpenChange={onOpenChange} busy={adjust.isPending} error={error} onSave={submit} saveLabel="Ajustar dose"
      title="Ajustar dose" description={`${treatment.medication}: dose atual ${formatMg(treatment.dose_mg)}. O ajuste entra no histórico com a data.`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="dose-new">Nova dose (mg)</Label>
          <Input id="dose-new" inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="Ex.: 5" autoFocus />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dose-date">Vale a partir de</Label>
          <Input id="dose-date" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="dose-note">Observação</Label>
        <Input id="dose-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: subiu após 4 semanas" />
      </div>
    </Shell>
  );
}

export function ApplicationDialog({ open, onOpenChange, patientId, treatment }: Base & { treatment: MedTreatment }) {
  const { apply } = useMedMutations(patientId);
  const [on, setOn] = useState("");
  const [dose, setDose] = useState("");
  const [place, setPlace] = useState<MedPlace>("home");
  const [stock, setStock] = useState(NO_STOCK);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setOn(todayIsoBR()); setDose(String(treatment.dose_mg).replace(".", ",")); setPlace(treatment.applied_where);
    setStock(stockValue(treatment.stock_item_id, treatment.stock_unit_id)); setNote(""); setError(null);
  }, [open, treatment]);

  function submit() {
    const s = splitStock(place === "clinic" ? stock : NO_STOCK);
    const invalid = validateApplication({ appliedOn: on, doseMg: dose, place, stockItem: s.item ?? "" }, todayIsoBR());
    if (invalid) return setError(invalid);
    setError(null);
    apply.mutate({ treatmentId: treatment.id, appliedOn: on, doseMg: parseMg(dose) as number, place, note: note.trim(), stockItem: s.item, stockUnit: s.unit }, {
      onSuccess: () => onOpenChange(false),
      onError: (e) => { captureException(e, { source: "medication", scope: "application" }); setError(medErrorMessage(e)); },
    });
  }
  return (
    <Shell open={open} onOpenChange={onOpenChange} busy={apply.isPending} error={error} onSave={submit} saveLabel="Registrar aplicação"
      title="Registrar aplicação" description={`${treatment.medication}. Se for na clínica, você pode dar baixa de 1 unidade no estoque.`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="app-date">Data</Label>
          <Input id="app-date" type="date" value={on} max={todayIsoBR()} onChange={(e) => setOn(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="app-dose">Dose (mg)</Label>
          <Input id="app-dose" inputMode="decimal" value={dose} onChange={(e) => setDose(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="app-place">Onde foi aplicada</Label>
        <PlaceSelect id="app-place" value={place} onChange={setPlace} />
      </div>
      {place === "clinic" ? (
        <StockPicker id="app-stock" patientId={patientId} value={stock} onChange={setStock} label="Dar baixa no estoque (opcional)" hint="Baixa 1 unidade. Se não houver saldo, nada é registrado." />
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="app-note">Observação</Label>
        <Input id="app-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Shell>
  );
}

export function DeliveryDialog({ open, onOpenChange, patientId, treatment }: Base & { treatment: MedTreatment }) {
  const { deliver } = useMedMutations(patientId);
  const [on, setOn] = useState("");
  const [qty, setQty] = useState("1");
  const [stock, setStock] = useState(NO_STOCK);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setOn(todayIsoBR()); setQty("1"); setStock(stockValue(treatment.stock_item_id, treatment.stock_unit_id)); setNote(""); setError(null);
  }, [open, treatment]);

  function submit() {
    const invalid = validateDelivery({ deliveredOn: on, quantity: qty }, todayIsoBR());
    if (invalid) return setError(invalid);
    const s = splitStock(stock);
    setError(null);
    deliver.mutate({ treatmentId: treatment.id, deliveredOn: on, quantity: Number(qty), note: note.trim(), stockItem: s.item, stockUnit: s.unit }, {
      onSuccess: () => onOpenChange(false),
      onError: (e) => { captureException(e, { source: "medication", scope: "delivery" }); setError(medErrorMessage(e)); },
    });
  }
  return (
    <Shell open={open} onOpenChange={onOpenChange} busy={deliver.isPending} error={error} onSave={submit} saveLabel="Registrar entrega"
      title="Registrar entrega" description={`${treatment.medication}: canetas ou doses entregues ao paciente.`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="del-date">Data da entrega</Label>
          <Input id="del-date" type="date" value={on} max={todayIsoBR()} onChange={(e) => setOn(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="del-qty">Quantidade (canetas/doses)</Label>
          <Input id="del-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} />
        </div>
      </div>
      <StockPicker id="del-stock" patientId={patientId} value={stock} onChange={setStock} label="Dar baixa no estoque (opcional)" hint="Baixa a mesma quantidade entregue. Se não houver saldo, nada é registrado." />
      <div className="space-y-2">
        <Label htmlFor="del-note">Observação</Label>
        <Input id="del-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Shell>
  );
}
