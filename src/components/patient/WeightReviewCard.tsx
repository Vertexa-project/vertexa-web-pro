import { AlertTriangle, Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePendingWeights, useReviewWeight, useWeightSeries } from "@/hooks/useBodyAssessments";
import { deltaLabel } from "@/lib/domain/weightReview";
import { formatWeight } from "@/lib/domain/format";

/** Pesos que o paciente confirmou apesar da variação >2 kg/dia. Até a equipe decidir, ficam fora do gráfico e do VRI. */
export function WeightReviewCard({ patientId }: { patientId: string }) {
  const pending = usePendingWeights(patientId);
  const series = useWeightSeries(patientId);
  const review = useReviewWeight(patientId);
  const list = pending.data ?? [];
  if (list.length === 0) return null;

  return (
    <Card className="border-amber-500/40" data-testid="weight-review">
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
        <CardTitle className="text-base">Peso para revisar ({list.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          O paciente confirmou estes valores mesmo com variação maior que 2 kg por dia. Enquanto você não decidir, eles ficam fora do gráfico e não contam para o VRI.
        </p>
        {list.map((w) => {
          const before = [...(series.data ?? [])].reverse().find((p) => new Date(p.date) < new Date(w.measured_at));
          return (
            <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div>
                <p className="text-sm font-semibold">{formatWeight(Number(w.weight_kg))}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(w.measured_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {deltaLabel(before?.weight ?? null, before?.date ?? null, Number(w.weight_kg))}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={review.isPending} aria-label={`Aprovar peso ${w.weight_kg} kg`} onClick={() => review.mutate({ id: w.id, decision: "approved" })}>
                  <Check className="mr-1 h-4 w-4" /> Aprovar
                </Button>
                <Button size="sm" variant="outline" disabled={review.isPending} aria-label={`Recusar peso ${w.weight_kg} kg`} onClick={() => review.mutate({ id: w.id, decision: "rejected" })}>
                  <X className="mr-1 h-4 w-4" /> Recusar
                </Button>
              </div>
            </div>
          );
        })}
        {review.isError && <p className="text-xs text-destructive">Não foi possível salvar a decisão. Tente de novo.</p>}
      </CardContent>
    </Card>
  );
}
