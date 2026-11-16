import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { derivePermissions } from "@/lib/domain/disciplines";
import { readDemo } from "../../../supabase/functions/_shared/docread/demo";
import type { DocKind, DocReadResult } from "../../../supabase/functions/_shared/docread/types";
import {
  buildAssessment, buildMeals, buildWorkouts, conferenceStatus, correctedCount, documentTitle, importAccess, inferMuscles, initConference,
  markChecked, pickOption, setFieldValue,
} from "./docImport";

const TODAY = "2026-11-16";
const fx = (n: string): string[] => JSON.parse(readFileSync(`${__dirname}/../../../supabase/functions/_shared/docread/fixtures/${n}.json`, "utf8"));
const read = (kind: DocKind, n: string): DocReadResult => readDemo({ kind, pages: fx(n), isImage: false, patientName: "Mariana Teste", today: TODAY });

describe("quem vê o botão de importar", () => {
  const educador = derivePermissions(["educador_fisico"]);
  const nutri = derivePermissions(["nutricionista"]);
  it("Recepção, Financeiro e Estoquista não veem o botão (mesmo com disciplina)", () => {
    for (const roles of [["recepcao"], ["financeiro"], ["estoquista"], ["financeiro", "recepcao"]]) {
      for (const k of ["bioimpedancia", "dieta", "treino"] as const) {
        expect(importAccess(k, derivePermissions(["nutricionista", "educador_fisico"]), false, roles).visible).toBe(false);
      }
    }
  });
  it("enquanto carrega, não aparece (fail-closed)", () => {
    expect(importAccess("treino", educador, true, [], true).visible).toBe(false);
  });
  it("educador físico: treino e bioimpedância liberados; dieta aparece travada com o motivo", () => {
    expect(importAccess("treino", educador, false, []).canWrite).toBe(true);
    expect(importAccess("bioimpedancia", educador, false, []).canWrite).toBe(true);
    const d = importAccess("dieta", educador, false, []);
    expect(d.visible).toBe(true);
    expect(d.canWrite).toBe(false);
    expect(d.reason).toMatch(/Nutricionista/);
  });
  it("nutricionista: dieta sim, treino não; sem disciplina nada escreve", () => {
    expect(importAccess("dieta", nutri, false, []).canWrite).toBe(true);
    expect(importAccess("treino", nutri, false, []).canWrite).toBe(false);
    expect(importAccess("bioimpedancia", derivePermissions([]), true, []).canWrite).toBe(false);
  });
});

describe("Conferência — o que libera o Confirmar", () => {
  it("bioimpedância limpa: libera de cara", () => {
    const r = read("bioimpedancia", "bioimpedancia-mariana-teste");
    expect(conferenceStatus("bioimpedancia", r, initConference(r), TODAY).canConfirm).toBe(true);
  });
  it("incertos bloqueiam até cada um ser conferido; o rodapé conta quantos faltam", () => {
    const r = read("bioimpedancia", "bioimpedancia-mariana-incerta");
    let st = initConference(r);
    let s = conferenceStatus("bioimpedancia", r, st, TODAY);
    expect(s.canConfirm).toBe(false);
    expect(s.pending.sort()).toEqual(["data", "gordura_pct", "massa_magra", "peso"]);
    expect(s.hint).toBe("Revise 4 campos em laranja para liberar.");
    st = pickOption("bioimpedancia", r, st, "peso", "70,3", TODAY);
    st = markChecked("bioimpedancia", r, st, "data", TODAY);
    st = markChecked("bioimpedancia", r, st, "gordura_pct", TODAY);
    s = conferenceStatus("bioimpedancia", r, st, TODAY);
    expect(s.pending).toEqual(["massa_magra"]);
    expect(s.hint).toBe("Revise 1 campo em laranja para liberar.");
    expect(s.canConfirm).toBe(false);
    st = markChecked("bioimpedancia", r, st, "massa_magra", TODAY);
    expect(conferenceStatus("bioimpedancia", r, st, TODAY).canConfirm).toBe(true);
  });
  it("editar um incerto já conferido exige conferir de novo", () => {
    const r = read("bioimpedancia", "bioimpedancia-mariana-incerta");
    let st = markChecked("bioimpedancia", r, initConference(r), "massa_magra", TODAY);
    expect(st.checked.massa_magra).toBe(true);
    st = setFieldValue(r, st, "massa_magra", "51,5");
    expect(st.checked.massa_magra).toBeUndefined();
  });
  it("não dá para 'conferir' valor inválido ou vazio de campo obrigatório", () => {
    const r = read("bioimpedancia", "bioimpedancia-mariana-incerta");
    let st = setFieldValue(r, initConference(r), "peso", "700");
    st = markChecked("bioimpedancia", r, st, "peso", TODAY);
    expect(st.checked.peso).toBeUndefined();
    expect(conferenceStatus("bioimpedancia", r, st, TODAY).invalid).toContain("peso");
  });
  it("valor de campo CERTO editado para algo fora da faixa também bloqueia", () => {
    const r = read("bioimpedancia", "bioimpedancia-mariana-teste");
    const st = setFieldValue(r, initConference(r), "agua", "500");
    const s = conferenceStatus("bioimpedancia", r, st, TODAY);
    expect(s.canConfirm).toBe(false);
    expect(s.hint).toBe("Corrija 1 campo com valor inválido.");
  });
  it("sem nenhum campo lido (foto sem IA em dieta/treino) nunca libera", () => {
    const r = readDemo({ kind: "dieta", pages: null, isImage: true });
    expect(conferenceStatus("dieta", r, initConference(r), TODAY).canConfirm).toBe(false);
  });
  it("foto de bioimpedância sem IA: campos vazios; só libera depois de preencher e conferir os obrigatórios", () => {
    const r = readDemo({ kind: "bioimpedancia", pages: null, isImage: true, today: TODAY });
    let st = initConference(r);
    expect(conferenceStatus("bioimpedancia", r, st, TODAY).canConfirm).toBe(false);
    for (const [k, v] of [["data", "10/11/2026"], ["peso", "70,3"], ["gordura_pct", "26,8"]]) {
      st = markChecked("bioimpedancia", r, setFieldValue(r, st, k, v), k, TODAY);
    }
    expect(conferenceStatus("bioimpedancia", r, st, TODAY).canConfirm).toBe(true);
  });
  it("conta campos corrigidos (só o número)", () => {
    const r = read("bioimpedancia", "bioimpedancia-mariana-incerta");
    let st = initConference(r);
    expect(correctedCount(r, st)).toBe(0);
    st = setFieldValue(r, st, "peso", "71,2");
    st = setFieldValue(r, st, "massa_magra", "51,5");
    st = setFieldValue(r, st, "agua", " 37,9 ");
    expect(correctedCount(r, st)).toBe(2);
  });
});

describe("Conferência → caminhos existentes", () => {
  it("bioimpedância → payload de avaliação (mesma validação do lançamento manual)", () => {
    const r = read("bioimpedancia", "bioimpedancia-mariana-teste");
    const v = buildAssessment(initConference(r), TODAY);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value).toMatchObject({ assessed_at: "2026-11-10", method: "bioimpedancia", weight: 70.3, body_fat_pct: 26.8 });
    expect(v.value.measurements).toMatchObject({ cintura: 78, quadril: 99, massa_magra_kg: 51.5, massa_muscular_kg: 28.6, agua_corporal_l: 37.9, gordura_visceral_nivel: 7, tmb_kcal: 1420 });
    expect(JSON.stringify(v.value.measurements)).not.toMatch(/abdomen/);
  });
  it("data futura ou peso inválido não gera payload", () => {
    const r = read("bioimpedancia", "bioimpedancia-mariana-teste");
    expect(buildAssessment(setFieldValue(r, initConference(r), "data", "20/12/2026"), TODAY).ok).toBe(false);
    expect(buildAssessment(setFieldValue(r, initConference(r), "peso", "700"), TODAY).ok).toBe(false);
  });
  it("dieta → refeições com horário, itens 'nome — quantidade' e calorias", () => {
    const r = read("dieta", "dieta-mariana-teste");
    let st = initConference(r);
    st = setFieldValue(r, st, "m0.i2", "100 g");
    const meals = buildMeals(r, st);
    expect(meals).toHaveLength(3);
    expect(meals[0]).toEqual({ time: "07:30", name: "Café da manhã", calories: 420, items: ["Ovos mexidos — 2 un", "Pão integral — 50 g", "Mamão — 100 g", "Leite desnatado — 200 ml"] });
    expect(meals[1].items[0]).toBe("Arroz — 4 colheres de sopa (100 g)");
    expect(meals[1].items[2]).toBe("Salada de folhas — à vontade");
    expect(buildMeals(r, initConference(r))[0].items[2]).toBe("Mamão"); // sem quantidade: só o nome
  });
  it("treino → dias com letra, exercícios, séries, reps e carga; grupos musculares só quando o nome deixa claro", () => {
    const r = read("treino", "treino-mariana-teste");
    let st = initConference(r);
    st = pickOption("treino", r, st, "d0.e1.reps", "10", TODAY);
    const w = buildWorkouts(r, st);
    expect(w.map((d) => [d.letter, d.name, d.primary_muscle_group])).toEqual([["A", "Peito e tríceps", "chest"], ["B", "Costas e bíceps", "lats"]]);
    expect(w[0].exercises[0]).toEqual({ name: "Supino reto", muscle_groups: ["chest"], sets: 4, reps: 10, load_kg: 20 });
    expect(w[0].exercises[1]).toMatchObject({ name: "Supino inclinado com halteres", reps: 10, load_kg: 12 });
    expect(w[0].exercises[2]).toMatchObject({ name: "Crucifixo", load_kg: null });
    expect(w[1].exercises.map((e) => e.name)).toEqual(["Puxada frontal", "Remada baixa", "Rosca direta", "Rosca martelo"]);
    expect(inferMuscles("Exercício misterioso")).toEqual([]);
  });
  it("título do documento diz a origem (modo e data)", () => {
    expect(documentTitle("bioimpedancia", "demo", "2026-11-16")).toBe("Bioimpedância · lido pela Vertexa IA (demonstração), conferido em 16/11/2026");
    expect(documentTitle("dieta", "openai", "2026-11-16")).toBe("Plano alimentar · lido pela Vertexa IA, conferido em 16/11/2026");
  });
});
