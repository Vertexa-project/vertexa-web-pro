/**
 * Biblioteca de exercícios (Oficina #581). Catálogo global (tabela exercise_library) com a mídia
 * enviada pela cliente no bucket público `exercise-library`. O exercício prescrito continua sendo
 * texto livre (workout_exercises.name): o GIF é resolvido pelo NOME ou por um APELIDO do catálogo,
 * comparados sem acento, caixa ou espaços repetidos.
 */
export const EXERCISE_LIBRARY_BUCKET = "exercise-library";

export interface ExerciseLibraryItem {
  id: string;
  name: string;
  groupKey: string;
  groupLabel: string;
  groupOrder: number;
  sortOrder: number;
  aliases: string[];
  /** Grupos musculares (chaves da ficha: chest, biceps, lats...); vazio em cardio/mobilidade. */
  muscleGroups: string[];
  /** URL pública da animação leve (webp animado), usada na tela. */
  mediaUrl: string;
  /** URL pública do GIF original, alternativa quando o webp não carrega. */
  gifUrl: string;
}

export interface ExerciseLibraryGroup {
  key: string;
  label: string;
  items: ExerciseLibraryItem[];
}

export function normalizeExerciseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function exerciseMediaUrl(supabaseUrl: string | undefined, path: string): string {
  const base = (supabaseUrl ?? "").replace(/\/+$/, "");
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${EXERCISE_LIBRARY_BUCKET}/${encoded}`;
}

/** Índice nome/apelido normalizado → item. O nome oficial vence um apelido igual de outro item. */
export function buildExerciseIndex(items: ExerciseLibraryItem[]): Map<string, ExerciseLibraryItem> {
  const index = new Map<string, ExerciseLibraryItem>();
  for (const item of items) {
    for (const alias of item.aliases) {
      const key = normalizeExerciseName(alias);
      if (key && !index.has(key)) index.set(key, item);
    }
  }
  for (const item of items) index.set(normalizeExerciseName(item.name), item);
  return index;
}

export function findLibraryExercise(
  index: Map<string, ExerciseLibraryItem>,
  name: string | null | undefined,
): ExerciseLibraryItem | null {
  if (!name) return null;
  return index.get(normalizeExerciseName(name)) ?? null;
}

/** Agrupa na ordem do catálogo; com busca, mantém só os itens cujo nome/apelido contém o termo. */
export function groupExercises(items: ExerciseLibraryItem[], query = ""): ExerciseLibraryGroup[] {
  const term = normalizeExerciseName(query);
  const matches = (item: ExerciseLibraryItem) =>
    !term ||
    normalizeExerciseName(item.name).includes(term) ||
    normalizeExerciseName(item.groupLabel).includes(term) ||
    item.aliases.some((a) => normalizeExerciseName(a).includes(term));
  const groups = new Map<string, ExerciseLibraryGroup & { order: number }>();
  for (const item of [...items].sort((a, b) => a.groupOrder - b.groupOrder || a.sortOrder - b.sortOrder)) {
    if (!matches(item)) continue;
    const g = groups.get(item.groupKey) ?? { key: item.groupKey, label: item.groupLabel, items: [], order: item.groupOrder };
    g.items.push(item);
    groups.set(item.groupKey, g);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order).map(({ key, label, items: list }) => ({ key, label, items: list }));
}

/**
 * Sugestões para o campo do exercício: cada palavra digitada precisa aparecer no nome, num apelido
 * ou no grupo (sem acento/caixa). Ordem: nome que começa com o texto, nome que contém, apelido.
 */
export function searchExercises(items: ExerciseLibraryItem[], query: string, limit = 8): ExerciseLibraryItem[] {
  const q = normalizeExerciseName(query);
  if (!q) return [];
  const tokens = q.split(" ");
  const scored: { item: ExerciseLibraryItem; score: number }[] = [];
  for (const item of items) {
    const name = normalizeExerciseName(item.name);
    const aliases = item.aliases.map(normalizeExerciseName);
    const haystack = [name, ...aliases, normalizeExerciseName(item.groupLabel)].join(" | ");
    if (!tokens.every((t) => haystack.includes(t))) continue;
    const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : aliases.some((a) => a.includes(q)) ? 2 : tokens.every((t) => name.includes(t)) ? 3 : 4;
    scored.push({ item, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.item.groupOrder - b.item.groupOrder || a.item.sortOrder - b.item.sortOrder)
    .slice(0, limit)
    .map((s) => s.item);
}
