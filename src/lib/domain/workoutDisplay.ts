// Exibição do plano de treino: repetições válidas e colunas sem dado. Puro.
import type { WorkoutExercise } from "@/types/db";

/**
 * Repetições para exibir. A coluna `reps` é INTEIRA no banco; aceita-se também texto de faixa
 * ("8-12", "8–12") por segurança. Negativo/zero/lixo (ex.: -35, resto de uma faixa "30-35" cortada)
 * => null (a tela mostra "—" em vez de inventar).
 */
export function formatReps(raw: number | string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    const m = raw.trim().match(/^(\d{1,3})\s*[-–]\s*(\d{1,3})$/);
    if (m) {
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      return lo >= 1 && hi >= lo ? `${lo}-${hi}` : null;
    }
    raw = Number(raw.trim());
  }
  return Number.isInteger(raw) && raw >= 1 && raw <= 999 ? String(raw) : null;
}

/** Valida o campo do formulário (string do input). Vazio é permitido. */
export function validateRepsInput(value: string): string | null {
  const t = value.trim();
  if (t === "") return null;
  return formatReps(t) ? null : "Repetições devem ser um número inteiro maior que zero.";
}

export interface WorkoutColumns {
  load: boolean;
  groups: boolean;
}

/** Só mostra Carga/Grupos se ao menos uma linha do treino tiver o dado. */
export function visibleColumns(exercises: ReadonlyArray<Pick<WorkoutExercise, "load_kg" | "muscle_groups">>): WorkoutColumns {
  return {
    load: exercises.some((e) => e.load_kg != null && e.load_kg > 0),
    groups: exercises.some((e) => (e.muscle_groups ?? []).length > 0),
  };
}
