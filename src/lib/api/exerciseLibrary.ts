import { supabase } from "@/lib/supabase";
import { exerciseMediaUrl, type ExerciseLibraryItem } from "@/lib/domain/exerciseLibrary";

interface ExerciseLibraryRow {
  id: string;
  name: string;
  group_key: string;
  group_label: string;
  group_order: number;
  sort_order: number;
  aliases: string[] | null;
  muscle_groups: string[] | null;
  media_webp: string;
  media_gif: string;
}

/** Catálogo inteiro (61 itens na v1): uma leitura só, ordenada por grupo e posição. */
export async function listExerciseLibrary(): Promise<ExerciseLibraryItem[]> {
  const { data, error } = await supabase
    .from("exercise_library")
    .select("id, name, group_key, group_label, group_order, sort_order, aliases, muscle_groups, media_webp, media_gif")
    .order("group_order", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw error;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  return ((data ?? []) as ExerciseLibraryRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    groupKey: r.group_key,
    groupLabel: r.group_label,
    groupOrder: r.group_order,
    sortOrder: r.sort_order,
    aliases: r.aliases ?? [],
    muscleGroups: r.muscle_groups ?? [],
    mediaUrl: exerciseMediaUrl(base, r.media_webp),
    gifUrl: exerciseMediaUrl(base, r.media_gif),
  }));
}
