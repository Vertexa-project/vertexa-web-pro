// Exceção da rotina para UM paciente: seguir o padrão da clínica, personalizar ou desligar.
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { PeriodWeekdayFields } from "./PeriodWeekdayFields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSaveRoutineOverride } from "@/hooks/useRoutine";
import { ROUTINE_ITEMS, type RoutineItemKey, type RoutinePeriod, type RoutineView } from "@/lib/domain/routine";

type Mode = "clinic" | "custom" | "off";
type Cfg = Record<RoutineItemKey, { period: RoutinePeriod; weekday: number }>;

function fromView(view: RoutineView | undefined): Cfg {
  const base: Cfg = { photo: { period: "monthly", weekday: 5 }, weight: { period: "monthly", weekday: 5 }, feedback: { period: "weekly", weekday: 5 } };
  for (const it of view?.items ?? []) base[it.key] = { period: it.period, weekday: it.weekday };
  return base;
}

export function RoutineOverrideDialog({ open, onOpenChange, patientId, patientName, view }: {
  open: boolean; onOpenChange: (o: boolean) => void; patientId: string; patientName: string; view?: RoutineView;
}) {
  const save = useSaveRoutineOverride(patientId);
  const [mode, setMode] = useState<Mode>("clinic");
  const [cfg, setCfg] = useState<Cfg>(fromView(view));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(view?.source === "custom" ? "custom" : view?.source === "patient_off" ? "off" : "clinic");
    setCfg(fromView(view));
    setError(null);
  }, [open, view]);

  const submit = () => {
    setError(null);
    const done = { onSuccess: () => onOpenChange(false), onError: () => setError("Não foi possível salvar. Tente de novo.") };
    if (mode === "clinic") save.mutate("clear", done);
    else if (mode === "off") save.mutate({ mode: "off" }, done);
    else save.mutate({ mode: "custom", settings: {
      photo_period: cfg.photo.period, photo_weekday: cfg.photo.weekday, weight_period: cfg.weight.period, weight_weekday: cfg.weight.weekday,
      feedback_period: cfg.feedback.period, feedback_weekday: cfg.feedback.weekday } }, done);
  };

  const options: Array<{ value: Mode; label: string; hint: string }> = [
    { value: "clinic", label: "Seguir o padrão da clínica", hint: "Muda junto quando a clínica mudar." },
    { value: "custom", label: "Personalizar para este paciente", hint: "Só este paciente muda; os outros seguem o padrão." },
    { value: "off", label: "Não pedir rotina a este paciente", hint: "O paciente não recebe os cartões da rotina." },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotina de {patientName}</DialogTitle>
          <DialogDescription>Escolha como a rotina vale para este paciente.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div role="radiogroup" aria-label="Rotina deste paciente" className="space-y-2">
            {options.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3">
                <input type="radio" name="routine-mode" className="mt-1 h-4 w-4 accent-[hsl(24_95%_53%)]" checked={mode === o.value} onChange={() => setMode(o.value)} />
                <span className="min-w-0"><span className="block text-sm font-medium text-foreground">{o.label}</span><span className="block break-words text-xs text-muted-foreground">{o.hint}</span></span>
              </label>
            ))}
          </div>
          {mode === "custom" ? (
            <div className="divide-y divide-border">
              {ROUTINE_ITEMS.map((it) => (
                <PeriodWeekdayFields key={it.key} id={`ovr-${it.key}`} label={it.label} period={cfg[it.key].period} weekday={cfg[it.key].weekday}
                  onChange={(v) => setCfg((c) => ({ ...c, [it.key]: v }))} />
              ))}
            </div>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </DialogBody>
        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={submit} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Salvar rotina do paciente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
