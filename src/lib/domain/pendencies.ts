// Pendências de registro — regras puras de "o que o paciente deixou de registrar".
// O paciente registra no app: peso (weight_logs), foto (progress_photos) e treino
// (activity_events type='workout_checked'). A web deriva, por recência, o que está
// atrasado — base do card "Pendências" do Dashboard e da lista de reativação.
//
// Thresholds (combinados/benchmark de retenção): peso a cada 7 dias, foto a cada 30,
// treino a cada 7. Sem registro algum = pendente (o paciente nunca registrou aquilo).

const DAY = 1000 * 60 * 60 * 24;

export const PENDENCY_THRESHOLDS = { weightDays: 7, photoDays: 30, workoutDays: 7 } as const;

export interface PendencyInput {
  lastWeightAt: string | null;
  lastPhotoAt: string | null;
  lastWorkoutAt: string | null;
}

export interface Pendencies {
  weight: boolean;
  photo: boolean;
  workout: boolean;
  /** Quantidade de pendências (0–3). */
  count: number;
  /** Rótulos curtos pt-BR das pendências ativas (para badges/listas). */
  labels: string[];
}

function isStaleSince(ts: string | null, days: number, now: number): boolean {
  if (!ts) return true; // nunca registrou → pendente
  return now - new Date(ts).getTime() > days * DAY;
}

export function computePendencies(input: PendencyInput, now: number = Date.now()): Pendencies {
  const weight = isStaleSince(input.lastWeightAt, PENDENCY_THRESHOLDS.weightDays, now);
  const photo = isStaleSince(input.lastPhotoAt, PENDENCY_THRESHOLDS.photoDays, now);
  const workout = isStaleSince(input.lastWorkoutAt, PENDENCY_THRESHOLDS.workoutDays, now);
  const labels: string[] = [];
  if (weight) labels.push("Sem peso (7d)");
  if (workout) labels.push("Sem treino (7d)");
  if (photo) labels.push("Sem foto (30d)");
  return { weight, photo, workout, count: labels.length, labels };
}

/** Tem ao menos uma pendência? */
export function hasPendency(input: PendencyInput, now: number = Date.now()): boolean {
  return computePendencies(input, now).count > 0;
}
