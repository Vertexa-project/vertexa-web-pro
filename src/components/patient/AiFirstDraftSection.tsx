import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { NutritionPlanEditor } from "./NutritionPlanEditor";
import { WorkoutPlanEditor } from "./WorkoutPlanEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useDisciplinePermissions } from "@/hooks/useDisciplines";
import { useGeneratePlanDraft, usePendingPlanDraft, usePlanDraftConfig, useResolvePlanDraft } from "@/hooks/usePlanDrafts";
import {
  draftSeal, friendlyPlanDraftError, NO_REPLACE_NOTICE, resolvePatientTypes, summarizeDraft,
  type AiPlanDraft, type PlanDraftKind,
} from "@/lib/domain/planDraft";
import type { NutritionPlanFull, PatientDetail, WorkoutPlanFull } from "@/types/db";

interface Props {
  patient: PatientDetail;
  kind: PlanDraftKind;
  /** Plano atual do paciente (nutrição) ou treino atual (publicado ou rascunho). */
  existing: NutritionPlanFull | WorkoutPlanFull | null;
}

const KIND_TEXT: Record<PlanDraftKind, { what: string; sources: string }> = {
  dieta: { what: "plano alimentar", sources: "peso e altura da última avaliação, objetivo, prontuário finalizado e restrições" },
  treino: { what: "treino", sources: "idade, peso e altura, objetivo, prontuário finalizado e limitações (ombro, joelho, lombar)" },
};

/**
 * A8 — "Gerar primeira versão (Vertexa IA)" nas abas Plano alimentar e Treino. Só aparece para quem tem a disciplina do plano
 * (nutricionista = dieta; educador físico/fisioterapeuta = treino). O rascunho fica em ai_plan_drafts: o paciente não vê e o plano
 * publicado só muda quando o profissional revisa e salva no editor.
 */
export function AiFirstDraftSection({ patient, kind, existing }: Props) {
  const { perms } = useDisciplinePermissions();
  const { data: professional } = useCurrentProfessional();
  const canGenerate = kind === "dieta" ? perms.canEditNutrition : perms.canEditWorkout;
  const pending = usePendingPlanDraft(patient.id, kind, canGenerate);
  const config = usePlanDraftConfig(professional?.clinicId ?? null, canGenerate);
  const generate = useGeneratePlanDraft(patient.id, kind);
  const resolve = useResolvePlanDraft(patient.id, kind);
  const [asking, setAsking] = useState(false);
  const [type, setType] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<AiPlanDraft | null>(null);

  if (!canGenerate) return null;
  const types = resolvePatientTypes(config.data?.patient_types);
  const draft = pending.data ?? null;
  const hasPublished = existing != null && (kind === "dieta" || (existing as WorkoutPlanFull).is_draft !== true);
  const text = KIND_TEXT[kind];

  function openAsk() {
    setError(null);
    setType((t) => (types.some((x) => x.key === t) ? t : types[0]?.key ?? ""));
    setAsking(true);
  }

  function handleGenerate() {
    setError(null);
    generate.mutate({ patientType: type, notes }, {
      onSuccess: (r) => { setAsking(false); setNotes(""); setReviewing(r.draft); },
      onError: (e) => setError(friendlyPlanDraftError(e instanceof Error ? e.message : "")),
    });
  }

  return (
    <div className="space-y-3" data-testid={`ai-first-draft-${kind}`}>
      {draft ? (
        <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <Badge tone="primary"><Sparkles className="mr-1 h-3 w-3" aria-hidden />{draftSeal(draft.mode)}</Badge>
              <p className="text-sm font-medium text-foreground">{draft.payload.title}</p>
              <p className="text-xs text-muted-foreground">{draft.patient_type_label} · {summarizeDraft(draft)}</p>
              <p className="text-xs text-muted-foreground">O paciente não vê este rascunho. Ele só vê o que você publicar.</p>
              {hasPublished ? <p role="note" className="text-xs font-medium text-primary-ink">{NO_REPLACE_NOTICE}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setReviewing(draft)}>Revisar rascunho</Button>
              <Button size="sm" variant="outline" onClick={openAsk}>Gerar de novo</Button>
              <Button size="sm" variant="ghost" disabled={resolve.isPending} onClick={() => resolve.mutate({ draftId: draft.id, decision: "descartado" })}>Descartar</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={openAsk}>
            <Sparkles className="h-4 w-4" aria-hidden />
            Gerar primeira versão (Vertexa IA)
          </Button>
          <span className="text-xs text-muted-foreground">Cria um rascunho para você revisar. Nada vai ao paciente sem você publicar.</span>
        </div>
      )}

      <Dialog open={asking} onOpenChange={(o) => { if (!generate.isPending) setAsking(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar primeira versão do {text.what}</DialogTitle>
            <DialogDescription>
              A Vertexa IA monta um rascunho com os dados da ficha ({text.sources}). Você revisa no editor antes de publicar.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`ai-type-${kind}`}>Tipo de paciente</Label>
              <select
                id={`ai-type-${kind}`}
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              {types.find((t) => t.key === type)?.hint ? <p className="text-xs text-muted-foreground">{types.find((t) => t.key === type)?.hint}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`ai-notes-${kind}`}>Observações para este paciente (opcional)</Label>
              <Textarea
                id={`ai-notes-${kind}`}
                value={notes}
                maxLength={1000}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex.: intolerante a lactose, dor no ombro direito, não gosta de peixe"
              />
            </div>
            {hasPublished ? <p role="note" className="text-sm text-primary-ink">{NO_REPLACE_NOTICE}</p> : null}
            {draft ? <p role="note" className="text-sm text-muted-foreground">Gerar de novo substitui o rascunho atual (o plano publicado não muda).</p> : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)} disabled={generate.isPending}>Cancelar</Button>
            <Button onClick={handleGenerate} disabled={generate.isPending || !type} aria-busy={generate.isPending}>
              {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {generate.isPending ? "Gerando…" : "Gerar rascunho"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {kind === "dieta" ? (
        <NutritionPlanEditor
          patient={patient}
          existing={(existing as NutritionPlanFull | null) ?? null}
          open={reviewing != null}
          onOpenChange={(o) => { if (!o) setReviewing(null); }}
          draft={reviewing}
          onDraftSaved={(d) => resolve.mutate({ draftId: d.id, decision: "usado" })}
        />
      ) : (
        <WorkoutPlanEditor
          patient={patient}
          existing={(existing as WorkoutPlanFull | null) ?? null}
          open={reviewing != null}
          onOpenChange={(o) => { if (!o) setReviewing(null); }}
          draft={reviewing}
          onDraftSaved={(d) => resolve.mutate({ draftId: d.id, decision: "usado" })}
        />
      )}
    </div>
  );
}
