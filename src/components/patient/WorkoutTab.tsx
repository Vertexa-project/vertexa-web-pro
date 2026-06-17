import { Dumbbell } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkoutPlan } from "@/hooks/usePlans";
import { formatWeight } from "@/lib/domain/format";
import { muscleGroupLabel } from "@/lib/domain/muscleRecovery";

export function WorkoutTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, refetch } = useWorkoutPlan(patientId);

  return (
    <AsyncSection
      isLoading={isLoading}
      isError={isError}
      isEmpty={!data}
      onRetry={() => refetch()}
      emptyIcon={Dumbbell}
      emptyTitle="Nenhum plano de treino"
      emptyDescription="Crie um treino para o paciente executar no app."
    >
      {data ? (
        <div className="space-y-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-foreground">{data.title}</h2>
            {data.goal ? <span className="text-sm text-muted-foreground">{data.goal}</span> : null}
          </div>

          {data.workouts.map((w) => (
            <Card key={w.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  {w.letter ? (
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-sm font-bold text-primary">
                      {w.letter}
                    </span>
                  ) : null}
                  {w.name}
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {w.primary_muscle_group ?? ""}
                  {w.estimated_minutes ? ` · ${w.estimated_minutes} min` : ""}
                </span>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-left text-sm">
                  <thead className="border-y bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-6 py-2">Exercício</th>
                      <th scope="col" className="px-4 py-2">Séries × Reps</th>
                      <th scope="col" className="px-4 py-2">Carga</th>
                      <th scope="col" className="px-6 py-2">Grupos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {w.workout_exercises.map((ex) => (
                      <tr key={ex.id}>
                        <td className="px-6 py-3 font-medium text-foreground">{ex.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {ex.sets ?? "—"} × {ex.reps ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {ex.load_kg != null ? formatWeight(ex.load_kg) : "—"}
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(ex.muscle_groups ?? []).map((g) => (
                              <Badge key={g} tone="muted">
                                {muscleGroupLabel(g)}
                              </Badge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </AsyncSection>
  );
}
