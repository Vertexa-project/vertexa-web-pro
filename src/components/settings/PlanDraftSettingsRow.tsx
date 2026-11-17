import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePlanDraftConfig, useSavePlanDraftConfig } from "@/hooks/usePlanDrafts";
import {
  BASE_OPTIONS, DEFAULT_PATIENT_TYPES, resolvePatientTypes, typeKeyFromLabel,
  type PatientTypeDef, type PlanBaseKey,
} from "@/lib/domain/planDraft";

/**
 * A8 — Configurações > Clínica > "Tipos de paciente (Vertexa IA)": o admin edita a lista de tipos usada em
 * "Gerar primeira versão (Vertexa IA)" e o texto do método da clínica (vai no prompt quando a IA estiver ligada).
 * Sem edição vale a lista padrão da reunião de 28/10.
 */
export function PlanDraftSettingsRow({ clinicId }: { clinicId: string | null }) {
  const cfg = usePlanDraftConfig(clinicId);
  const save = useSavePlanDraftConfig(clinicId);
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<PatientTypeDef[]>([...DEFAULT_PATIENT_TYPES]);
  const [methodDieta, setMethodDieta] = useState("");
  const [methodTreino, setMethodTreino] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTypes(resolvePatientTypes(cfg.data?.patient_types));
    setMethodDieta(cfg.data?.method_dieta ?? "");
    setMethodTreino(cfg.data?.method_treino ?? "");
    setError(null);
  }, [open, cfg.data]);

  const patch = (i: number, p: Partial<PatientTypeDef>) => setTypes((ts) => ts.map((t, k) => (k === i ? { ...t, ...p } : t)));

  function handleSave() {
    const clean = types.map((t) => ({ ...t, label: t.label.trim(), hint: t.hint?.trim() || undefined }));
    if (clean.length === 0 || clean.some((t) => t.label.length < 2)) {
      setError("Cada tipo precisa de um nome com pelo menos 2 letras.");
      return;
    }
    setError(null);
    save.mutate(
      { patient_types: clean, method_dieta: methodDieta.trim() || null, method_treino: methodTreino.trim() || null },
      {
        onSuccess: () => { setOpen(false); setSaved(true); window.setTimeout(() => setSaved(false), 3000); },
        onError: () => setError("Não foi possível salvar agora. Só o administrador da clínica pode alterar."),
      },
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!clinicId}>Editar tipos e método</Button>
        {saved ? <span role="status" className="text-xs text-success">Salvo.</span> : null}
      </div>
      <Dialog open={open} onOpenChange={(o) => { if (!save.isPending) setOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tipos de paciente e método (Vertexa IA)</DialogTitle>
            <DialogDescription>
              Esta lista aparece em “Gerar primeira versão (Vertexa IA)”, no plano alimentar e no treino. Cada tipo usa um modelo-base; o texto do método entra no pedido à IA quando ela estiver ligada.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {types.map((t, i) => (
              <div key={t.key} className="space-y-2 rounded-lg border p-3" data-testid="patient-type-row">
                <div className="flex items-center gap-2">
                  <Input value={t.label} maxLength={80} onChange={(e) => patch(i, { label: e.target.value })} aria-label={`Nome do tipo ${i + 1}`} />
                  <Button variant="ghost" size="icon" aria-label={`Remover tipo ${t.label}`} disabled={types.length === 1}
                    className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setTypes((ts) => ts.filter((_, k) => k !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select value={t.base} aria-label={`Modelo-base do tipo ${i + 1}`} onChange={(e) => patch(i, { base: e.target.value as PlanBaseKey })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {BASE_OPTIONS.map((b) => <option key={b.value} value={b.value}>Modelo: {b.label}</option>)}
                  </select>
                  <Input value={t.hint ?? ""} maxLength={400} onChange={(e) => patch(i, { hint: e.target.value })} placeholder="Orientação curta (opcional)" aria-label={`Orientação do tipo ${i + 1}`} />
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setTypes((ts) => [...ts, { key: typeKeyFromLabel(`novo tipo ${ts.length + 1}`, ts.map((x) => x.key)), label: "", base: "manutencao" }])}>
                <Plus className="h-4 w-4" />Adicionar tipo
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setTypes([...DEFAULT_PATIENT_TYPES])}>Restaurar lista padrão</Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pd-method-dieta">Método da clínica — dieta (opcional)</Label>
              <Textarea id="pd-method-dieta" value={methodDieta} maxLength={4000} onChange={(e) => setMethodDieta(e.target.value)}
                placeholder="Ex.: sempre 5 refeições, proteína em todas, estratégia para vontade de doce…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pd-method-treino">Método da clínica — treino (opcional)</Label>
              <Textarea id="pd-method-treino" value={methodTreino} maxLength={4000} onChange={(e) => setMethodTreino(e.target.value)}
                placeholder="Ex.: começar sempre com 3 dias A/B/C e carga leve nas 2 primeiras semanas…" />
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>Cancelar</Button>
            <Button onClick={handleSave} disabled={save.isPending} aria-busy={save.isPending}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {save.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
