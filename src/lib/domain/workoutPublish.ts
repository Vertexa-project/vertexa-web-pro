// Treino publicado × rascunho (redesign P6) — regras PURAS. Publicado = o paciente vê e faz qualquer treino, em qualquer dia,
// com a animação da Biblioteca e a instrução do exercício. Rascunho nunca aparece no app (o banco esconde só do próprio paciente).
// Plano que já existia antes do recurso conta como publicado (is_draft nasce false).
import { isDisciplineDenied, DISCIPLINE_REASON, type DisciplinePermissions } from "./disciplines";

export type Publication = "publicado" | "rascunho";

export interface PublicationFields {
  is_draft?: boolean | null;
  published_at?: string | null;
}

export function publicationOf(plan: PublicationFields | null | undefined): Publication {
  return plan?.is_draft ? "rascunho" : "publicado";
}

/** O paciente enxerga este plano no app? (mesma regra da policy do banco). */
export function visibleToPatient(plan: PublicationFields | null | undefined): boolean {
  return Boolean(plan) && !plan?.is_draft;
}

export const PUBLICATION_BADGE: Record<Publication, string> = {
  publicado: "Ativo no app",
  rascunho: "Rascunho · nada foi publicado",
};

export interface SummarisedExercise {
  name: string;
  gif_url?: string | null;
  notes?: string | null;
}
export interface SummarisedWorkout {
  letter: string | null;
  name: string;
  workout_exercises: SummarisedExercise[];
}

export interface PublishSummary {
  days: number;
  dayLetters: string[];
  exercises: number;
  withAnimation: number;
  withInstruction: number;
  /** Nada a publicar sem exercício (a função do banco também recusa). */
  canPublish: boolean;
}

/** Letra do dia: a cadastrada; sem ela, A, B, C… pela ordem do treino no plano (nunca número). */
export function dayLetter(letter: string | null | undefined, index: number): string {
  const l = letter?.trim();
  if (l) return l;
  const n = Math.max(0, Math.floor(index));
  return n < 26 ? String.fromCharCode(65 + n) : `${String.fromCharCode(65 + (n % 26))}${Math.floor(n / 26)}`;
}

/** Resumo mostrado antes de publicar: dias liberados e quantos exercícios têm animação e instrução. */
export function summarizePublish(workouts: SummarisedWorkout[], hasAnimation: (name: string, gifUrl?: string | null) => boolean): PublishSummary {
  const all = workouts.flatMap((w) => w.workout_exercises);
  return {
    days: workouts.filter((w) => w.workout_exercises.length > 0).length,
    dayLetters: workouts.flatMap((w, i) => (w.workout_exercises.length > 0 ? [dayLetter(w.letter, i)] : [])),
    exercises: all.length,
    withAnimation: all.filter((e) => hasAnimation(e.name, e.gif_url)).length,
    withInstruction: all.filter((e) => Boolean(e.notes?.trim())).length,
    canPublish: all.length > 0,
  };
}

/** "A, B e C" / "A e B" / "A". */
export function listLetters(letters: string[]): string {
  if (letters.length <= 1) return letters.join("");
  return `${letters.slice(0, -1).join(", ")} e ${letters[letters.length - 1]}`;
}

/** Quem publica: a mesma disciplina que edita o treino (educador físico ou fisioterapeuta). */
export function canPublishWorkout(perms: Pick<DisciplinePermissions, "canEditWorkout">): boolean {
  return perms.canEditWorkout;
}

export function publishErrorMessage(err: unknown): string {
  const msg = (err as { message?: string } | null)?.message ?? "";
  if (/workout_plan_empty/i.test(msg)) return "Adicione ao menos um exercício antes de publicar.";
  if (isDisciplineDenied(err)) return DISCIPLINE_REASON.workout;
  return "Não foi possível publicar agora. Tente novamente.";
}
