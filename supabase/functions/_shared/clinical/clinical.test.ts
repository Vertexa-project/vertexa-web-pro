import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildJsonSchema, validateAiOutput } from "./aiSchema";
import { DEMO_FIELD_KEYS, DEMO_SEGMENTS, demoOrd, demoSegmentsForChunk, demoStructure } from "./demoScript";
import { splitIntoSegments } from "./openai";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import { applyManualEdit, mergeAiFields, type RecordFields } from "./record";
import { AGREEMENTS_KEY, DEFAULT_SECTIONS, listFieldKeys, RETURN_KEY } from "./template";

const keys = new Set(listFieldKeys(DEFAULT_SECTIONS));

describe("modelo padrão", () => {
  it("tem 16 seções e a de sistema não tem campo preenchível", () => {
    expect(DEFAULT_SECTIONS).toHaveLength(16);
    expect(DEFAULT_SECTIONS.map((s) => s.id)).toEqual([
      "identificacao", "objetivo", "historia", "antecedentes_pessoais", "medicacoes", "suplementos",
      "antecedentes_familiares", "habitos", "revisao_sistemas", "exame_fisico", "exames_trazidos",
      "avaliacao", "conduta", "combinados", "retorno", "profissional",
    ]);
    expect([...keys].some((k) => k.startsWith("profissional."))).toBe(false);
    expect(keys.has(AGREEMENTS_KEY)).toBe(true);
    expect(keys.has(RETURN_KEY)).toBe(true);
  });

  it("o seed da migration v2 é igual ao modelo do código", () => {
    const sql = readFileSync("supabase/migrations/20261113130000_clinical_template_v2.sql", "utf8");
    const json = sql.split("$json$")[1];
    expect(JSON.parse(json)).toEqual(DEFAULT_SECTIONS);
  });
});

describe("mescla IA × edição manual", () => {
  const base: RecordFields = {};
  it("IA preenche campos livres e ignora chave desconhecida e valor em branco", () => {
    const r = mergeAiFields(base, {
      "objetivo.queixa_principal": { value: " cansaço ", sources: [1] },
      "campo.inexistente": { value: "x", sources: [1] },
      "objetivo.objetivo_principal": { value: "  ", sources: [] },
    }, keys, "t");
    expect(r.applied).toEqual(["objetivo.queixa_principal"]);
    expect(r.skipped.sort()).toEqual(["campo.inexistente", "objetivo.objetivo_principal"]);
    expect(r.fields["objetivo.queixa_principal"].value).toBe("cansaço");
  });
  it("campo editado à mão fica travado para a IA", () => {
    const manual = applyManualEdit(base, "objetivo.queixa_principal", "Minha versão", "t");
    expect(manual["objetivo.queixa_principal"].locked).toBe(true);
    const r = mergeAiFields(manual, {
      "objetivo.queixa_principal": { value: "IA", sources: [2] },
      "objetivo.objetivo_principal": { value: "Emagrecer", sources: [2] },
    }, keys);
    expect(r.fields["objetivo.queixa_principal"].value).toBe("Minha versão");
    expect(r.fields["objetivo.objetivo_principal"].value).toBe("Emagrecer");
    expect(r.skipped).toContain("objetivo.queixa_principal");
  });
  it("IA não apaga campo preenchido com valor vazio", () => {
    const filled = mergeAiFields(base, { "historia.fatores_desencadeantes": { value: "Gestação", sources: [1] } }, keys).fields;
    const r = mergeAiFields(filled, { "historia.fatores_desencadeantes": { value: "", sources: [] } }, keys);
    expect(r.fields["historia.fatores_desencadeantes"].value).toBe("Gestação");
  });
});

describe("validação do JSON da IA", () => {
  const ords = new Set([1, 2]);
  it("aceita saída válida", () => {
    const r = validateAiOutput({ fields: { "habitos.sono": { value: "5 h", sources: [2, 1, 2] } } }, keys, ords);
    expect(r).toEqual({ ok: true, fields: { "habitos.sono": { value: "5 h", sources: [1, 2] } } });
  });
  it.each([
    ["raiz inválida", null],
    ["sem fields", {}],
    ["chave desconhecida", { fields: { "x.y": { value: "a", sources: [1] } } }],
    ["valor não texto", { fields: { "habitos.sono": { value: 5, sources: [1] } } }],
    ["fonte inexistente", { fields: { "habitos.sono": { value: "a", sources: [9] } } }],
    ["valor sem fonte (inventado)", { fields: { "habitos.sono": { value: "a", sources: [] } } }],
    ["texto longo demais", { fields: { "habitos.sono": { value: "a".repeat(4001), sources: [1] } } }],
  ])("recusa: %s", (_n, raw) => {
    expect(validateAiOutput(raw, keys, ords).ok).toBe(false);
  });
  it("campo vazio sem fonte é aceito (sem informação)", () => {
    expect(validateAiOutput({ fields: { "habitos.sono": { value: "", sources: [] } } }, keys, ords).ok).toBe(true);
  });
  it("JSON Schema cobre todos os campos e nenhum da seção de sistema", () => {
    const s = buildJsonSchema(DEFAULT_SECTIONS) as { properties: { fields: { required: string[] } } };
    expect(s.properties.fields.required.sort()).toEqual([...keys].sort());
  });
});

describe("prompt", () => {
  it("lista campos, trechos e campos travados; nunca a seção profissional", () => {
    const sys = buildSystemPrompt();
    expect(sys).toContain("SOMENTE o que foi dito");
    const u = buildUserPrompt(DEFAULT_SECTIONS, [{ ord: 1, speaker: "Médica", text: "Oi" }], {
      "habitos.sono": { value: "x", sources: [], locked: true },
    });
    expect(u).toContain("[1] Médica: Oi");
    expect(u).toContain("habitos.sono");
    expect(u).not.toContain("profissional.nome");
  });
});

describe("modo demonstração", () => {
  it("roteiro fictício de ~18 trechos, 2 por pedaço", () => {
    expect(DEMO_SEGMENTS.length).toBe(18);
    expect(demoSegmentsForChunk(0).map((s) => s.ord)).toEqual([0, 1]);
    expect(demoSegmentsForChunk(3).map((s) => s.ord)).toEqual([3000, 3001]);
    expect(demoSegmentsForChunk(9)).toEqual([]);
  });
  it("preenche as 15 seções clínicas só com o que já chegou e cada fonte existe", () => {
    const all = new Set(DEMO_SEGMENTS.map((_, i) => demoOrd(i)));
    const full = demoStructure(all);
    expect(Object.keys(full)).toEqual(DEMO_FIELD_KEYS);
    const sections = new Set(Object.keys(full).map((k) => k.split(".")[0]));
    expect(sections.size).toBe(15);
    expect(validateAiOutput({ fields: full }, keys, all).ok).toBe(true);
    const early = demoStructure(new Set([demoOrd(0), demoOrd(1)]));
    expect(Object.keys(early)).toHaveLength(6);
    expect(Object.keys(early).every((k) => k.startsWith("identificacao.") || k === "habitos.rotina_trabalho")).toBe(true);
  });
});

describe("trechos da transcrição real", () => {
  it("corta em fim de frase", () => {
    const parts = splitIntoSegments("Primeira frase. " + "b".repeat(300) + ". Terceira.", 320);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(" ")).toContain("Terceira.");
  });
});
