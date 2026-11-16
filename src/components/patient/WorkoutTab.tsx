import { useState } from "react";
import { Dumbbell, Pencil, Plus } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { DocImportSection } from "./docimport/DocImportSection";
import { ExerciseMedia } from "@/components/exercise/ExerciseMedia";
import { GatedAction } from "./GatedAction";
import { WorkoutPlanEditor } from "./WorkoutPlanEditor";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkoutPlan } from "@/hooks/usePlans";
import { useExerciseLibrary } from "@/hooks/useExerciseLibrary";
import { findLibraryExercise } from "@/lib/domain/exerciseLibrary";
import { formatNumber, formatWeight } from "@/lib/domain/format";
import { formatReps, visibleColumns } from "@/lib/domain/workoutDisplay";
import { muscleGroupLabel } from "@/lib/domain/muscleRecovery";
import { muscleGroupLabelSafe } from "@/lib/domain/reportLabels";
import { useDisciplinePermissions } from "@/hooks/useDisciplines";
import { DISCIPLINE_REASON } from "@/lib/domain/disciplines";
import type { PatientDetail } from "@/types/db";

export function WorkoutTab({ patient }: { patient: PatientDetail }) {
  const { data, isLoading, isError, refetch } = useWorkoutPlan(patient.id);
  const [editing, setEditing] = useState(false);
  const { perms } = useDisciplinePermissions();
  const canEdit = perms.canEditWorkout;
  const library = useExerciseLibrary();

  return (
    <>
      <div className="mb-4">
        <DocImportSection patient={patient} kind="treino" />
      </div>
      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        isEmpty={!data}
        onRetry={() => refetch()}
        emptyIcon={Dumbbell}
        emptyTitle="Nenhum plano de treino"
        emptyDescription="Crie um treino para o paciente executar no app."
        emptyAction={
          <GatedAction
            canEdit={canEdit}
            reason={DISCIPLINE_REASON.workout}
            wrapperClassName="items-center"
            onClick={() => setEditing(true)}
          >
            <Plus className="h-4 w-4" />
            Criar plano
          </GatedAction>
        }
      >
        {data ? (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{data.title}</h2>
                {data.goal ? <span className="text-sm text-muted-foreground">{data.goal}</span> : null}
              </div>
              <GatedAction
                canEdit={canEdit}
                reason={DISCIPLINE_REASON.workout}
                wrapperClassName="items-end"
                variant="outline"
                className="shrink-0"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-4 w-4" />
                Editar
              </GatedAction>
            </div>

          {data.workouts.map((w) => {
            const cols = visibleColumns(w.workout_exercises);
            return (
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
                  {w.primary_muscle_group ? muscleGroupLabelSafe(w.primary_muscle_group) : ""}
                  {w.estimated_minutes ? ` · ${w.estimated_minutes} min` : ""}
                </span>
              </CardHeader>
              <CardContent className="relative overflow-x-auto p-0">
                <table className="w-full text-left text-sm">
                  <thead className="border-y bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 sm:px-6">Exercício</th>
                      <th scope="col" className="px-3 py-2 sm:px-4">Séries × Reps</th>
                      {cols.load ? <th scope="col" className="hidden px-4 py-2 sm:table-cell">Carga</th> : null}
                      {cols.groups ? <th scope="col" className="hidden px-6 py-2 sm:table-cell">Grupos</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {w.workout_exercises.map((ex) => (
                      <tr key={ex.id}>
                        <td className="px-3 py-3 font-medium text-foreground sm:px-6">
                          <div className="flex items-center gap-3">
                            {(() => {
                              const match = findLibraryExercise(library.index, ex.name);
                              return match ? (
                                <ExerciseMedia item={match} className="h-10 w-12 shrink-0 rounded-md" />
                              ) : null;
                            })()}
                            <div className="min-w-0">
                              <span>{ex.name}</span>
                              {/* No celular, carga e grupos vão embaixo do nome (sem coluna cortada nem rolagem lateral). */}
                              {(cols.load && ex.load_kg != null && ex.load_kg > 0) || (cols.groups && (ex.muscle_groups ?? []).length > 0) ? (
                                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs font-normal text-muted-foreground sm:hidden">
                                  {cols.load && ex.load_kg != null && ex.load_kg > 0 ? <span>Carga {formatWeight(ex.load_kg)}</span> : null}
                                  {cols.groups ? (ex.muscle_groups ?? []).map((g) => (
                                    <Badge key={g} tone="muted">{muscleGroupLabel(g)}</Badge>
                                  )) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted-foreground sm:px-4">
                          {ex.sets != null ? formatNumber(Number(ex.sets), 1) : "—"} × {formatReps(ex.reps) ?? "—"}
                        </td>
                        {cols.load ? (
                          <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                            {ex.load_kg != null && ex.load_kg > 0 ? formatWeight(ex.load_kg) : "—"}
                          </td>
                        ) : null}
                        {cols.groups ? (
                          <td className="hidden px-6 py-3 sm:table-cell">
                            <div className="flex flex-wrap gap-1">
                              {(ex.muscle_groups ?? []).map((g) => (
                                <Badge key={g} tone="muted">
                                  {muscleGroupLabel(g)}
                                </Badge>
                              ))}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            );
          })}
        </div>
      ) : null}
      </AsyncSection>

      <WorkoutPlanEditor
        patient={patient}
        existing={data ?? null}
        open={editing}
        onOpenChange={setEditing}
      />
    </>
  );
}
