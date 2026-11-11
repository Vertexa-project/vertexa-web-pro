import { describe, expect, it } from "vitest";

import {
  buildExerciseIndex,
  exerciseMediaUrl,
  findLibraryExercise,
  groupExercises,
  normalizeExerciseName,
  searchExercises,
  type ExerciseLibraryItem,
} from "./exerciseLibrary";

const item = (over: Partial<ExerciseLibraryItem>): ExerciseLibraryItem => ({
  id: "x",
  name: "X",
  groupKey: "g",
  groupLabel: "G",
  groupOrder: 0,
  sortOrder: 0,
  aliases: [],
  muscleGroups: [],
  mediaUrl: "m",
  gifUrl: "g",
  ...over,
});

const items = [
  item({ id: "triceps_corda-polia", name: "Tríceps corda na polia", groupKey: "triceps", groupLabel: "Tríceps", groupOrder: 4, aliases: ["Tríceps corda"] }),
  item({ id: "posterior_mesa-flexora", name: "Mesa flexora", groupKey: "posterior", groupLabel: "Posterior de coxa", groupOrder: 7 }),
  item({ id: "costas_remada-cavalinho", name: "Remada cavalinho", groupKey: "costas", groupLabel: "Costas", groupOrder: 0 }),
];

describe("biblioteca de exercícios", () => {
  it("normaliza acento, caixa e espaços", () => {
    expect(normalizeExerciseName("  Tríceps   CORDA na Polia ")).toBe("triceps corda na polia");
  });

  it("acha o exercício pelo nome digitado de outro jeito e pelo apelido", () => {
    const index = buildExerciseIndex(items);
    expect(findLibraryExercise(index, "triceps corda na polia")?.id).toBe("triceps_corda-polia");
    expect(findLibraryExercise(index, "Mesa Flexora")?.id).toBe("posterior_mesa-flexora");
    expect(findLibraryExercise(index, "Tríceps corda")?.id).toBe("triceps_corda-polia");
  });

  it("não inventa GIF para variante que não está no catálogo", () => {
    const index = buildExerciseIndex(items);
    expect(findLibraryExercise(index, "Cadeira flexora")).toBeNull();
    expect(findLibraryExercise(index, "")).toBeNull();
    expect(findLibraryExercise(index, null)).toBeNull();
  });

  it("o nome oficial vence o apelido igual de outro exercício", () => {
    const index = buildExerciseIndex([
      item({ id: "a", name: "Remada", aliases: [] }),
      item({ id: "b", name: "Remada baixa", aliases: ["Remada"] }),
    ]);
    expect(findLibraryExercise(index, "remada")?.id).toBe("a");
  });

  it("agrupa na ordem do catálogo e filtra pela busca", () => {
    expect(groupExercises(items).map((g) => g.key)).toEqual(["costas", "triceps", "posterior"]);
    const found = groupExercises(items, "corda");
    expect(found).toHaveLength(1);
    expect(found[0].items[0].id).toBe("triceps_corda-polia");
    expect(groupExercises(items, "posterior")[0].key).toBe("posterior");
    expect(groupExercises(items, "nada disso")).toEqual([]);
  });

  it("sugere pelo nome curto, sem acento e por palavras soltas", () => {
    const list = [
      item({ id: "s1", name: "Supino sentado na máquina", aliases: ["supino maquina"], groupLabel: "Peito" }),
      item({ id: "s2", name: "Supino reto com halteres", groupLabel: "Peito", sortOrder: 1 }),
      item({ id: "m", name: "Mesa flexora", groupLabel: "Posterior" }),
    ];
    expect(searchExercises(list, "Supino máquina").map((i) => i.id)).toEqual(["s1"]);
    expect(searchExercises(list, "supino").map((i) => i.id)).toEqual(["s1", "s2"]);
    expect(searchExercises(list, "SUPINO MAQUINA")[0].id).toBe("s1");
    expect(searchExercises(list, "posterior").map((i) => i.id)).toEqual(["m"]);
    expect(searchExercises(list, "")).toEqual([]);
    expect(searchExercises(list, "xyz")).toEqual([]);
  });

  it("monta a URL pública do bucket", () => {
    expect(exerciseMediaUrl("https://p.supabase.co/", "core/core_dead-bug.webp")).toBe(
      "https://p.supabase.co/storage/v1/object/public/exercise-library/core/core_dead-bug.webp",
    );
  });
});
