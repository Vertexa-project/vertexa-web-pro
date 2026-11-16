// Publicar treino (redesign P6, como no protótipo): mostra o que será liberado e publica. Sem amarra de dia: o paciente vê e faz
// qualquer treino em qualquer dia, com a animação da Biblioteca e a instrução do exercício.
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { usePublishWorkout } from "@/hooks/usePublishWorkout";
import { listLetters, publishErrorMessage, type PublishSummary } from "@/lib/domain/workoutPublish";
import { captureException } from "@/lib/observability/sentry";
import { shortName } from "@/lib/domain/format";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientName: string;
  planId: string;
  summary: PublishSummary;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <b className="text-right font-semibold text-foreground">{value}</b>
    </div>
  );
}

export function PublishWorkoutDialog({ open, onOpenChange, patientId, patientName, planId, summary }: Props) {
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const publish = usePublishWorkout(patientId);

  function handlePublish() {
    setError(null);
    publish.mutate(
      { planId, notify },
      {
        onSuccess: () => onOpenChange(false),
        onError: (e) => {
          captureException(e, { source: "publish", scope: "workout" });
          setError(publishErrorMessage(e));
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!publish.isPending) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Publicar o treino para {shortName(patientName) || "o paciente"}?</DialogTitle>
          <DialogDescription>
            Depois de publicado, o paciente vê todos os treinos no app e escolhe qual fazer em cada dia.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div>
            <Field label="Dias liberados no app" value={summary.days > 0 ? `Todos (${listLetters(summary.dayLetters)})` : "Nenhum"} />
            <Field label="Exercícios com animação" value={`${summary.withAnimation} de ${summary.exercises}`} />
            <Field label="Exercícios com instrução" value={`${summary.withInstruction} de ${summary.exercises}`} />
          </div>
          {summary.exercises > 0 && summary.withAnimation < summary.exercises ? (
            <p className="text-xs text-muted-foreground">
              Exercício sem animação aparece só com o nome. Escolha o exercício pela lista da Biblioteca para o paciente ver o movimento.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <input id="pub-notify" type="checkbox" className="h-4 w-4 accent-primary" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <Label htmlFor="pub-notify" className="font-normal">Avisar o paciente pelo app</Label>
          </div>
          {!summary.canPublish ? (
            <p className="text-sm text-destructive" role="alert">Adicione ao menos um exercício antes de publicar.</p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={publish.isPending}>
            Voltar ao rascunho
          </Button>
          <Button onClick={handlePublish} disabled={!summary.canPublish || publish.isPending} aria-busy={publish.isPending}>
            {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {publish.isPending ? "Publicando…" : "Publicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
