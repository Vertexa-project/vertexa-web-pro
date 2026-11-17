// Validação do rascunho (demo e OpenAI passam pela mesma rede de segurança).
import type { LibraryExercise, NutritionDraft, WorkoutDraft } from "./types.ts";

export function validateNutrition(d: NutritionDraft): string[] {
  const e: string[] = [];
  if (!d.title?.trim()) e.push("título vazio");
  if (!Array.isArray(d.meals) || d.meals.length < 1 || d.meals.length > 10) e.push("quantidade de refeições inválida");
  for (const m of d.meals ?? []) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time)) e.push(`horário inválido em ${m.name}`);
    if (!m.name?.trim()) e.push("refeição sem nome");
    if (!Array.isArray(m.items) || m.items.length < 1 || m.items.length > 12 || m.items.some((x) => !x.trim() || x.length > 200)) e.push(`itens inválidos em ${m.name}`);
    if (!Number.isInteger(m.calories) || m.calories < 0 || m.calories > 2500) e.push(`calorias inválidas em ${m.name}`);
    if ((m.options ?? []).length > 5) e.push(`opções demais em ${m.name}`);
  }
  const total = (d.meals ?? []).reduce((a, m) => a + (m.calories || 0), 0);
  if (total < 600 || total > 6000) e.push(`total de calorias fora do plausível (${total})`);
  return e;
}

/** Só exercícios da biblioteca (comparação sem maiúscula/acento). Devolve o nome canônico em `fix` quando só a grafia difere. */
const key = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

export function canonicalizeWorkout(d: WorkoutDraft, library: readonly LibraryExercise[]): void {
  const by = new Map(library.map((x) => [key(x.name), x]));
  for (const w of d.workouts) for (const ex of w.exercises) {
    const hit = by.get(key(ex.name));
    if (hit) { ex.name = hit.name; if (!ex.muscle_groups?.length) ex.muscle_groups = [hit.group_key]; }
  }
}

export function validateWorkout(d: WorkoutDraft, library: readonly LibraryExercise[]): string[] {
  const e: string[] = [];
  const names = new Set(library.map((x) => key(x.name)));
  if (!d.title?.trim()) e.push("título vazio");
  if (!Array.isArray(d.workouts) || d.workouts.length < 1 || d.workouts.length > 7) e.push("quantidade de treinos inválida");
  for (const w of d.workouts ?? []) {
    if (!w.name?.trim()) e.push("treino sem nome");
    if (!Array.isArray(w.exercises) || w.exercises.length < 1 || w.exercises.length > 14) e.push(`exercícios inválidos em ${w.name}`);
    for (const ex of w.exercises ?? []) {
      if (!names.has(key(ex.name))) e.push(`exercício fora da biblioteca: ${ex.name}`);
      if (!Number.isInteger(ex.sets) || ex.sets < 1 || ex.sets > 8) e.push(`séries inválidas em ${ex.name}`);
      if (!Number.isInteger(ex.reps) || ex.reps < 1 || ex.reps > 100) e.push(`repetições inválidas em ${ex.name}`);
      if (!Number.isInteger(ex.rest_seconds) || ex.rest_seconds < 0 || ex.rest_seconds > 1800) e.push(`intervalo inválido em ${ex.name}`);
      if (!ex.notes?.trim() || ex.notes.length > 500) e.push(`instrução ausente/longa em ${ex.name}`);
    }
  }
  return e;
}
