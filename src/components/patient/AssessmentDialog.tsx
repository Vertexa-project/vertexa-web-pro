import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useCreateAssessment, useUpdateAssessment } from "@/hooks/useBodyAssessments";
import { assessmentErrorMessage } from "@/lib/api/assessments";
import {
  assessmentToForm,
  ASSESSMENT_METHODS,
  emptyAssessmentForm,
  MEASURE_FIELDS,
  NOTES_MAX,
  validateAssessment,
  type AssessmentForm,
} from "@/lib/domain/anthropometry";
import type { BodyAssessment } from "@/types/db";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const inputCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

/**
 * Lançamento manual de avaliação (peso, % gordura e circunferências) com DATA retroativa — registra medidas
 * antigas do paciente. `assessment` presente = edição. A barreira real é o servidor (RLS).
 */
export function AssessmentDialog({
  patientId,
  open,
  onOpenChange,
  assessment,
}: {
  patientId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assessment?: BodyAssessment | null;
}) {
  const create = useCreateAssessment(patientId);
  const update = useUpdateAssessment(patientId);
  const { data: me } = useCurrentProfessional();
  const [form, setForm] = useState<AssessmentForm>(() => emptyAssessmentForm(todayYmd()));
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(assessment ? assessmentToForm(assessment, todayYmd()) : emptyAssessmentForm(todayYmd()));
  }, [open, assessment]);

  const set = (patch: Partial<AssessmentForm>) => setForm((f) => ({ ...f, ...patch }));

  async function submit() {
    setError(null);
    const r = validateAssessment(form, todayYmd(), assessment?.measurements ?? null);
    if (!r.ok) return setError(r.error);
    try {
      if (assessment) await update.mutateAsync({ id: assessment.id, payload: r.value });
      else await create.mutateAsync({ ...r.value, professionalId: me?.id ?? null });
      onOpenChange(false);
    } catch (err) {
      setError(assessmentErrorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!pending ? onOpenChange(v) : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{assessment ? "Editar avaliação" : "Adicionar avaliação"}</DialogTitle>
          <DialogDescription>
            Lance medidas atuais ou antigas. Informe a data em que foram tiradas; o gráfico e os relatórios passam a usá-las.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="as-day">Data da avaliação</Label>
              <input id="as-day" type="date" className={inputCls} value={form.day} max={todayYmd()} disabled={pending} onChange={(e) => set({ day: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="as-method">Método</Label>
              <Select value={form.method} onValueChange={(v) => set({ method: v })} disabled={pending}>
                <SelectTrigger id="as-method" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSESSMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="as-weight">Peso (kg)</Label>
              <input id="as-weight" inputMode="decimal" className={inputCls} value={form.weight} disabled={pending} onChange={(e) => set({ weight: e.target.value })} placeholder="72,5" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="as-fat">% de gordura</Label>
              <input id="as-fat" inputMode="decimal" className={inputCls} value={form.bodyFat} disabled={pending} onChange={(e) => set({ bodyFat: e.target.value })} placeholder="28,4" />
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-foreground">Circunferências (cm)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {MEASURE_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`as-${f.key}`} className="text-xs text-muted-foreground">{f.label}</Label>
                  <input
                    id={`as-${f.key}`}
                    inputMode="decimal"
                    className={inputCls}
                    value={form.measures[f.key] ?? ""}
                    disabled={pending}
                    onChange={(e) => set({ measures: { ...form.measures, [f.key]: e.target.value } })}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="as-notes">Observações (opcional)</Label>
            <textarea
              id="as-notes"
              rows={2}
              maxLength={NOTES_MAX}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={form.notes}
              disabled={pending}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {pending ? "Salvando…" : "Salvar avaliação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
