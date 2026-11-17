import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildFacts, ageFrom } from "./facts";
import { generateDraft, buildSystemPrompt, buildUserPrompt, type ModelCall } from "./generate";
import { DEFAULT_PATIENT_TYPES, resolvePatientTypes } from "./patientTypes";
import { estimateEnergy, buildNutritionDraft } from "./nutrition";
import { detectRestrictions } from "./restrictions";
import { INSTRUCTION, TEMPLATE_EXERCISE_IDS, buildWorkoutDraft } from "./workout";
import { validateNutrition, validateWorkout } from "./validate";
import { BASE_KEYS, type LibraryExercise, type PlanFacts } from "./types";

const SQL = readFileSync(resolve(process.cwd(), "supabase/migrations/20261111140000_exercise_library.sql"), "utf8");
const LIB: LibraryExercise[] = [...SQL.matchAll(/^\s*\('([a-z0-9_-]+)', '([^']+)', '([a-z]+)', '([^']+)', (\d+), (\d+)/gm)]
  .map((m) => ({ id: m[1], name: m[2], group_key: m[3], group_label: m[4], sort_order: Number(m[6]) }));

const FACTS: PlanFacts = {
  sex: "f", ageYears: 34, heightCm: 165, weightKg: 82, weightSource: "avaliação corporal de 03/11/2026", bodyFatPct: 36, goal: "Emagrecimento",
  targetWeightKg: 68, clinicalText: "", encounterAt: "05/11/2026", examTitles: ["Hemograma"], notes: "",
};
const type = (key: string) => DEFAULT_PATIENT_TYPES.find((t) => t.key === key)!;

describe("biblioteca usada nos testes", () => {
  it("leu a biblioteca real da migration", () => { expect(LIB.length).toBeGreaterThanOrEqual(55); });
  it("todo exercício dos modelos existe na biblioteca", () => {
    const ids = new Set(LIB.map((e) => e.id));
    for (const id of TEMPLATE_EXERCISE_IDS) expect(ids.has(id), id).toBe(true);
  });
  it("todo exercício dos modelos tem instrução própria", () => {
    for (const id of TEMPLATE_EXERCISE_IDS) expect(INSTRUCTION[id], id).toBeTruthy();
  });
});

describe("tipos de paciente", () => {
  it("padrão da reunião inclui os 4 pedidos + abaixo do peso/pré-diabético", () => {
    const keys = DEFAULT_PATIENT_TYPES.map((t) => t.key);
    for (const k of ["emagrecimento", "hipertrofia", "recomposicao", "cardiometabolico", "abaixo_peso", "pre_diabetico"]) expect(keys).toContain(k);
    expect(DEFAULT_PATIENT_TYPES.every((t) => (BASE_KEYS as readonly string[]).includes(t.base))).toBe(true);
  });
  it("configuração da clínica substitui o padrão; item inválido é ignorado; vazia volta ao padrão", () => {
    const r = resolvePatientTypes([{ key: "gestante", label: "Gestante", base: "retomada" }, { key: "X", label: "ruim", base: "retomada" }, { key: "y1", label: "Base inventada", base: "nao_existe" }]);
    expect(r.map((t) => t.key)).toEqual(["gestante"]);
    expect(resolvePatientTypes(null).length).toBe(DEFAULT_PATIENT_TYPES.length);
    expect(resolvePatientTypes([{ key: "X", label: "x", base: "retomada" }]).length).toBe(DEFAULT_PATIENT_TYPES.length);
  });
});

describe("fatos da ficha", () => {
  it("usa a última antropometria; sem ela, o peso da ficha; calcula idade em Brasília", () => {
    const now = new Date("2026-11-17T12:00:00Z");
    const f = buildFacts({ patient: { birth_date: "1990-11-18", sex: "female", height_cm: 165, current_weight: 80, goal: "Perder peso" }, assessment: { weight: 78.4, body_fat_pct: 33, assessed_at: "2026-11-03" }, encounter: null, docs: [], notes: "", now });
    expect(f.ageYears).toBe(35); expect(f.weightKg).toBe(78.4); expect(f.sex).toBe("f"); expect(f.weightSource).toContain("avaliação corporal");
    const g = buildFacts({ patient: { height_cm: 165, current_weight: 80 }, assessment: null, encounter: null, docs: [], notes: "", now });
    expect(g.weightKg).toBe(80); expect(g.weightSource).toBe("peso atual da ficha"); expect(g.ageYears).toBeNull();
    expect(ageFrom("1990-11-17", now)).toBe(36);
  });
  it("junta prontuário e observações para detectar restrições", () => {
    const f = buildFacts({ patient: {}, assessment: null, docs: [], notes: "dor no ombro direito", encounter: { finalized_at: "2026-11-05T15:00:00Z", final_fields: { "queixa.hda": { value: "Intolerante a lactose" } } } });
    expect(f.clinicalText).toContain("lactose"); expect(f.clinicalText).toContain("ombro"); expect(f.encounterAt).toBe("05/11/2026");
  });
});

describe("dieta (demonstração)", () => {
  it("calorias pelo peso/altura/idade/sexo reais (Mifflin × 1,4 × fator do tipo)", () => {
    const e = estimateEnergy(FACTS, "emagrecimento");
    const bmr = 10 * 82 + 6.25 * 165 - 5 * 34 - 161;
    expect(e.bmr).toBe(Math.round(bmr)); expect(e.tdee).toBe(Math.round(bmr * 1.4)); expect(e.target).toBe(Math.round((bmr * 1.4 * 0.8) / 10) * 10);
    expect(estimateEnergy(FACTS, "hipertrofia").target).toBeGreaterThan(estimateEnergy(FACTS, "emagrecimento").target);
  });
  it("sem peso: usa referência e avisa; piso de segurança no déficit", () => {
    const d = buildNutritionDraft({ facts: { ...FACTS, weightKg: null }, base: "emagrecimento", typeLabel: "x", restrictions: { food: [], train: [] } });
    expect(d.warnings.join(" ")).toContain("Sem peso");
    const leve = estimateEnergy({ ...FACTS, weightKg: 40, heightCm: 150 }, "emagrecimento");
    expect(leve.target).toBeGreaterThanOrEqual(1200);
  });
  for (const base of BASE_KEYS) {
    it(`${base}: refeições válidas, soma = meta e determinístico`, () => {
      const a = buildNutritionDraft({ facts: FACTS, base, typeLabel: "T", restrictions: { food: [], train: [] } });
      const b = buildNutritionDraft({ facts: FACTS, base, typeLabel: "T", restrictions: { food: [], train: [] } });
      expect(a).toEqual(b);
      expect(validateNutrition(a)).toEqual([]);
      expect(a.totalKcal).toBe(estimateEnergy(FACTS, base).target);
      expect(a.meals.length).toBe(6);
      expect(a.meals.every((m) => m.items.every((i) => !i.includes("{") && !i.includes("~")))).toBe(true);
    });
  }
  it("tipos diferentes geram planos diferentes (não é o mesmo texto)", () => {
    const e = buildNutritionDraft({ facts: FACTS, base: "emagrecimento", typeLabel: "A", restrictions: { food: [], train: [] } });
    const h = buildNutritionDraft({ facts: FACTS, base: "hipertrofia", typeLabel: "B", restrictions: { food: [], train: [] } });
    const c = buildNutritionDraft({ facts: FACTS, base: "cardiometabolico", typeLabel: "C", restrictions: { food: [], train: [] } });
    expect(new Set([e, h, c].map((x) => x.meals[2].items.join("|"))).size).toBe(3);
    expect(c.guidance.join(" ")).toContain("cardiometabólico");
  });
  it("quantidades crescem com as calorias", () => {
    const m = (kg: number) => buildNutritionDraft({ facts: { ...FACTS, weightKg: kg, heightCm: 180, sex: "m" }, base: "hipertrofia", typeLabel: "x", restrictions: { food: [], train: [] } }).meals[2].items[1];
    const grams = (s: string) => Number(s.match(/\((\d+) g\)/)![1]);
    expect(grams(m(110))).toBeGreaterThan(grams(m(55)));
  });
  it("restrição alimentar troca os itens (lactose, vegetariano, glúten)", () => {
    const r = detectRestrictions("Paciente intolerante a lactose, vegetariana, doença celíaca");
    expect(r.food).toEqual(expect.arrayContaining(["lactose", "carne", "gluten"]));
    const d = buildNutritionDraft({ facts: FACTS, base: "emagrecimento", typeLabel: "x", restrictions: r });
    const all = d.meals.flatMap((m) => [...m.items, ...m.options.flatMap((o) => o.items)]).join(" | ").toLowerCase();
    expect(all).not.toMatch(/frango|carne|peixe|pão integral|aveia/);
    expect(all).not.toMatch(/iogurte natural|leite desnatado|queijo/);
    expect(all).toContain("tofu"); expect(d.basis.join(" ")).toContain("Restrições detectadas");
  });
  it("sem anamnese avisa; com anamnese e exame cita a origem", () => {
    expect(buildNutritionDraft({ facts: { ...FACTS, encounterAt: null }, base: "retomada", typeLabel: "x", restrictions: { food: [], train: [] } }).warnings.join(" ")).toContain("Sem prontuário");
    const ok = buildNutritionDraft({ facts: FACTS, base: "retomada", typeLabel: "x", restrictions: { food: [], train: [] } });
    expect(ok.basis.join(" ")).toContain("Prontuário finalizado em 05/11/2026"); expect(ok.basis.join(" ")).toContain("Hemograma");
  });
});

describe("treino (demonstração)", () => {
  const names = new Set(LIB.map((e) => e.name));
  for (const base of BASE_KEYS) {
    it(`${base}: só exercícios da biblioteca, com instrução e intervalo`, () => {
      const d = buildWorkoutDraft({ facts: FACTS, base, typeLabel: "T", restrictions: { food: [], train: [] }, library: LIB });
      expect(validateWorkout(d, LIB)).toEqual([]);
      expect(d.workouts.length).toBeGreaterThanOrEqual(2);
      for (const w of d.workouts) for (const e of w.exercises) {
        expect(names.has(e.name)).toBe(true); expect(e.notes.length).toBeGreaterThan(10); expect(e.rest_seconds).toBeGreaterThan(0);
        expect(Number.isInteger(e.reps) && e.reps > 0).toBe(true); expect(e.load_kg).toBeNull(); expect(e.muscle_groups.length).toBe(1);
      }
      expect(d).toEqual(buildWorkoutDraft({ facts: FACTS, base, typeLabel: "T", restrictions: { food: [], train: [] }, library: LIB }));
    });
  }
  it("emagrecimento, hipertrofia e cardiometabólico têm A/B/C e fichas diferentes", () => {
    const f = (b: "emagrecimento" | "hipertrofia" | "cardiometabolico") => buildWorkoutDraft({ facts: FACTS, base: b, typeLabel: "T", restrictions: { food: [], train: [] }, library: LIB });
    for (const b of ["emagrecimento", "hipertrofia", "cardiometabolico"] as const) expect(f(b).workouts.map((w) => w.letter)).toEqual(["A", "B", "C"]);
    expect(f("hipertrofia").workouts[0].exercises.map((e) => e.name)).not.toEqual(f("emagrecimento").workouts[0].exercises.map((e) => e.name));
  });
  it("limitação de ombro e joelho troca exercícios; nada marcado como evitado sobra", () => {
    const r = detectRestrictions("Tendinite no ombro direito e condromalacia no joelho");
    expect(r.train).toEqual(expect.arrayContaining(["ombro", "joelho"]));
    const d = buildWorkoutDraft({ facts: FACTS, base: "hipertrofia", typeLabel: "T", restrictions: r, library: LIB });
    const all = d.workouts.flatMap((w) => w.exercises.map((e) => e.name));
    expect(all).not.toContain("Supino reto com halteres"); expect(all).not.toContain("Desenvolvimento militar em pé"); expect(all).not.toContain("Agachamento búlgaro");
    expect(d.basis.join(" ")).toContain("Cuidados detectados"); expect(validateWorkout(d, LIB)).toEqual([]);
  });
  it("IMC ≥ 35 evita exercícios de impacto; idade ≥ 60 reduz séries e aumenta intervalo", () => {
    const heavy = buildWorkoutDraft({ facts: { ...FACTS, weightKg: 120, heightCm: 165 }, base: "recomposicao", typeLabel: "T", restrictions: { food: [], train: [] }, library: LIB });
    expect(heavy.basis.join(" ")).toContain("impacto");
    const old = buildWorkoutDraft({ facts: { ...FACTS, ageYears: 65 }, base: "manutencao", typeLabel: "T", restrictions: { food: [], train: [] }, library: LIB });
    const young = buildWorkoutDraft({ facts: FACTS, base: "manutencao", typeLabel: "T", restrictions: { food: [], train: [] }, library: LIB });
    expect(old.workouts[0].exercises[0].sets).toBeLessThan(young.workouts[0].exercises[0].sets);
    expect(old.workouts[0].exercises[0].rest_seconds).toBe(young.workouts[0].exercises[0].rest_seconds + 15);
  });
  it("biblioteca sem um exercício: troca por outro do grupo ou avisa, nunca inventa", () => {
    const lib = LIB.filter((e) => e.id !== "quadriceps_agachamento-goblet");
    const d = buildWorkoutDraft({ facts: FACTS, base: "emagrecimento", typeLabel: "T", restrictions: { food: [], train: [] }, library: lib });
    expect(d.workouts.flatMap((w) => w.exercises.map((e) => e.name))).not.toContain("Agachamento goblet");
    expect(validateWorkout(d, lib)).toEqual([]);
  });
});

describe("OpenAI pronto (modelo simulado)", () => {
  const goodWorkout = { title: "Treino IA", goal: "x", workouts: [{ letter: "A", name: "Dia A", primary_muscle_group: "costas", estimated_minutes: 40, exercises: [{ name: "puxada neutra na polia", sets: 3, reps: 12, rest_seconds: 60, notes: "Puxe até o peito." }] }] };
  it("sem chave = demo; com chave e resposta válida = openai; método da clínica vai no prompt", async () => {
    const demo = await generateDraft({ kind: "treino", facts: FACTS, type: type("hipertrofia"), library: LIB, method: null, call: null });
    expect(demo.mode).toBe("demo");
    let seenSystem = "";
    const call: ModelCall = async (system) => { seenSystem = system; return goodWorkout; };
    const r = await generateDraft({ kind: "treino", facts: FACTS, type: type("hipertrofia"), library: LIB, method: "Priorizar treino de força.", call });
    expect(r.mode).toBe("openai"); expect(seenSystem).toContain("Priorizar treino de força."); expect(JSON.stringify(r.payload)).toContain("Puxada neutra na polia");
  });
  it("exercício fora da biblioteca ou resposta ruim → cai no modelo-base (demo) com aviso", async () => {
    const bad: ModelCall = async () => ({ ...goodWorkout, workouts: [{ ...goodWorkout.workouts[0], exercises: [{ name: "Supino com barra olímpica inventado", sets: 3, reps: 10, rest_seconds: 60, notes: "x" }] }] });
    const r = await generateDraft({ kind: "treino", facts: FACTS, type: type("hipertrofia"), library: LIB, method: null, call: bad });
    expect(r.mode).toBe("demo"); expect(JSON.stringify(r.payload)).toContain("não respondeu no formato esperado");
    const boom: ModelCall = async () => { throw new Error("vertexa_provider_500"); };
    expect((await generateDraft({ kind: "dieta", facts: FACTS, type: type("emagrecimento"), library: [], method: null, call: boom })).mode).toBe("demo");
  });
  it("dieta pelo modelo é validada (total absurdo é rejeitado)", async () => {
    const meals = [{ time: "07:00", name: "Café", items: ["x"], calories: 9000 }];
    const r = await generateDraft({ kind: "dieta", facts: FACTS, type: type("emagrecimento"), library: [], method: null, call: async () => ({ title: "t", meals }) });
    expect(r.mode).toBe("demo");
    const ok = await generateDraft({ kind: "dieta", facts: FACTS, type: type("emagrecimento"), library: [], method: null, call: async () => ({ title: "t", meals: [{ time: "07:00", name: "Café", items: ["x"], calories: 900 }, { time: "12:00", name: "Almoço", items: ["y"], calories: 700 }] }) });
    expect(ok.mode).toBe("openai");
  });
  it("o prompt do usuário não leva o nome do paciente", () => {
    const u = buildUserPrompt("dieta", { ...FACTS, clinicalText: "texto" }, type("emagrecimento"), { food: [], train: [] }, { targetKcal: 1500 });
    expect(u).not.toMatch(/nome/i); expect(u).toContain("1500");
    expect(buildSystemPrompt("dieta", null)).not.toContain("MÉTODO DA CLÍNICA");
  });
});
