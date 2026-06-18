import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSaveWorkoutPlan } from "@/hooks/usePlanMutations";
import type { SaveWorkoutPlanInput } from "@/lib/api/planMutations";
import type { PatientDetail, WorkoutPlanFull } from "@/types/db";

interface ExerciseForm {
  name: string;
  muscleGroups: string;
  sets: string;
  reps: string;
  load: string;
}
interface WorkoutForm {
  letter: string;
  name: string;
  muscle: string;
  minutes: string;
  exercises: ExerciseForm[];
}
interface PlanForm {
  title: string;
  goal: string;
  workouts: WorkoutForm[];
}

const emptyExercise = (): ExerciseForm => ({ name: "", muscleGroups: "", sets: "", reps: "", load: "" });
const emptyWorkout = (): WorkoutForm => ({ letter: "", name: "", muscle: "", minutes: "", exercises: [emptyExercise()] });

function fromExisting(plan: WorkoutPlanFull | null): PlanForm {
  if (!plan) return { title: "", goal: "", workouts: [emptyWorkout()] };
  return {
    title: plan.title,
    goal: plan.goal ?? "",
    workouts: plan.workouts.map((w) => ({
      letter: w.letter ?? "",
      name: w.name,
      muscle: w.primary_muscle_group ?? "",
      minutes: w.estimated_minutes?.toString() ?? "",
      exercises: w.workout_exercises.length
        ? w.workout_exercises.map((ex) => ({
            name: ex.name,
            muscleGroups: (ex.muscle_groups ?? []).join(", "),
            sets: ex.sets?.toString() ?? "",
            reps: ex.reps?.toString() ?? "",
            load: ex.load_kg?.toString() ?? "",
          }))
        : [emptyExercise()],
    })),
  };
}

interface Props {
  patient: PatientDetail;
  existing: WorkoutPlanFull | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WorkoutPlanEditor({ patient, existing, open, onOpenChange }: Props) {
  const [form, setForm] = useState<PlanForm>(() => fromExisting(existing));
  const [error, setError] = useState<string | null>(null);
  const save = useSaveWorkoutPlan(patient.id);

  useEffect(() => {
    if (open) {
      setForm(fromExisting(existing));
      setError(null);
    }
  }, [open, existing]);

  function patchWorkout(i: number, patch: Partial<WorkoutForm>) {
    setForm((f) => ({ ...f, workouts: f.workouts.map((w, idx) => (idx === i ? { ...w, ...patch } : w)) }));
  }
  function patchExercise(wi: number, ei: number, patch: Partial<ExerciseForm>) {
    setForm((f) => ({
      ...f,
      workouts: f.workouts.map((w, idx) =>
        idx === wi
          ? { ...w, exercises: w.exercises.map((e, j) => (j === ei ? { ...e, ...patch } : e)) }
          : w,
      ),
    }));
  }

  function handleSave() {
    if (!form.title.trim()) {
      setError("Dê um título ao plano.");
      return;
    }
    const workouts = form.workouts.filter((w) => w.name.trim());
    if (workouts.length === 0) {
      setError("Adicione ao menos um treino com nome.");
      return;
    }
    const input: SaveWorkoutPlanInput = {
      patientId: patient.id,
      professionalId: patient.professionals[0]?.id ?? null,
      title: form.title.trim(),
      goal: form.goal.trim() || null,
      workouts: workouts.map((w) => ({
        letter: w.letter.trim() || null,
        name: w.name.trim(),
        primary_muscle_group: w.muscle.trim() || null,
        estimated_minutes: w.minutes ? Number(w.minutes) : null,
        exercises: w.exercises
          .filter((e) => e.name.trim())
          .map((e) => ({
            name: e.name.trim(),
            muscle_groups: e.muscleGroups.split(",").map((s) => s.trim()).filter(Boolean),
            sets: e.sets ? Number(e.sets) : null,
            reps: e.reps ? Number(e.reps) : null,
            load_kg: e.load ? Number(e.load) : null,
          })),
      })),
    };
    save.mutate(input, {
      onSuccess: () => onOpenChange(false),
      onError: () => setError("Não foi possível salvar o plano. Tente novamente."),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Editar plano de treino" : "Novo plano de treino"}</DialogTitle>
          <DialogDescription>O paciente verá este plano no app.</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="wp-title">Título</Label>
              <Input
                id="wp-title"
                autoFocus
                aria-invalid={Boolean(error) && !form.title.trim()}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Ex.: Treino de emagrecimento"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wp-goal">Objetivo</Label>
              <Input
                id="wp-goal"
                value={form.goal}
                onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
                placeholder="Ex.: Déficit + preservação de massa"
              />
            </div>
          </div>

          {form.workouts.map((w, wi) => (
            <div key={wi} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <Input
                  className="w-14"
                  value={w.letter}
                  onChange={(e) => patchWorkout(wi, { letter: e.target.value })}
                  placeholder="A"
                  aria-label="Letra do treino"
                />
                <Input
                  value={w.name}
                  onChange={(e) => patchWorkout(wi, { name: e.target.value })}
                  placeholder="Nome do treino (ex.: Costas e Bíceps)"
                  aria-label="Nome do treino"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Remover treino"
                  disabled={form.workouts.length === 1}
                  onClick={() =>
                    setForm((f) => ({ ...f, workouts: f.workouts.filter((_, idx) => idx !== wi) }))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={w.muscle}
                  onChange={(e) => patchWorkout(wi, { muscle: e.target.value })}
                  placeholder="Grupo principal (ex.: Costas)"
                  aria-label="Grupo muscular principal"
                />
                <Input
                  type="number"
                  value={w.minutes}
                  onChange={(e) => patchWorkout(wi, { minutes: e.target.value })}
                  placeholder="Duração (min)"
                  aria-label="Duração estimada"
                />
              </div>

              <div className="space-y-2">
                {w.exercises.map((ex, ei) => (
                  <div key={ei} className="grid grid-cols-[1fr_auto] gap-2">
                    <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr]">
                      <Input
                        value={ex.name}
                        onChange={(e) => patchExercise(wi, ei, { name: e.target.value })}
                        placeholder="Exercício"
                        aria-label="Nome do exercício"
                      />
                      <Input
                        type="number"
                        value={ex.sets}
                        onChange={(e) => patchExercise(wi, ei, { sets: e.target.value })}
                        placeholder="Séries"
                        aria-label="Séries"
                      />
                      <Input
                        type="number"
                        value={ex.reps}
                        onChange={(e) => patchExercise(wi, ei, { reps: e.target.value })}
                        placeholder="Reps"
                        aria-label="Repetições"
                      />
                      <Input
                        type="number"
                        value={ex.load}
                        onChange={(e) => patchExercise(wi, ei, { load: e.target.value })}
                        placeholder="Carga"
                        aria-label="Carga (kg)"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remover exercício"
                      onClick={() =>
                        patchWorkout(wi, { exercises: w.exercises.filter((_, j) => j !== ei) })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => patchWorkout(wi, { exercises: [...w.exercises, emptyExercise()] })}
                >
                  <Plus className="h-4 w-4" />
                  Exercício
                </Button>
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            onClick={() => setForm((f) => ({ ...f, workouts: [...f.workouts, emptyWorkout()] }))}
          >
            <Plus className="h-4 w-4" />
            Adicionar treino
          </Button>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={save.isPending} aria-busy={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {save.isPending ? "Salvando…" : "Salvar plano"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
