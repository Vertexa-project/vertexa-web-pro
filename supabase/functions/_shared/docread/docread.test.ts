import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DISCIPLINE_WRITE_MAP } from "../../../../src/lib/domain/disciplines";
import { hasClinicalAccess as hasClinicalAccessAi } from "../vertexa/access";
import { canReadDocFor, DOC_WRITE_DISCIPLINES, hasClinicalAccess, sniffMime } from "./access";
import { readDemo } from "./demo";
import { normalizeModelOutput } from "./model";
import { fmtNumberBR, parseDateBR, parseNumberBR } from "./numbers";
import { NOTICE_NO_TEXT, NOTICE_PHOTO_NEEDS_AI, type DocKind, type DocReadResult, type ReadField } from "./types";
import { applyRules, checkPatientName, crossCheckBio, validateValue, verifyAgainstText } from "./validate";

const fx = (n: string): string[] => JSON.parse(readFileSync(`${__dirname}/fixtures/${n}.json`, "utf8"));
const TODAY = "2026-11-16";
const read = (kind: DocKind, name: string): DocReadResult => readDemo({ kind, pages: fx(name), isImage: false, patientName: "Mariana Teste", today: TODAY });
const val = (r: DocReadResult, key: string) => r.fields.find((f) => f.key === key);

describe("números pt-BR", () => {
  it("lê vírgula, milhar e ponto decimal", () => {
    expect(parseNumberBR("26,8")).toBe(26.8);
    expect(parseNumberBR("70.3")).toBe(70.3);
    expect(parseNumberBR("1.420", { integer: true })).toBe(1420);
    expect(parseNumberBR("1.420,5")).toBe(1420.5);
    expect(parseNumberBR("1.420,5", { integer: true })).toBeNull();
    expect(parseNumberBR("abc")).toBeNull();
    expect(parseNumberBR("")).toBeNull();
    expect(parseNumberBR("1,2,3")).toBeNull();
  });
  it("formata com vírgula", () => {
    expect(fmtNumberBR(70.3)).toBe("70,3");
    expect(fmtNumberBR(78)).toBe("78");
  });
  it("datas dd/mm/aaaa válidas", () => {
    expect(parseDateBR("10/11/2026")).toBe("2026-11-10");
    expect(parseDateBR("10-11-26")).toBe("2026-11-10");
    expect(parseDateBR("2026-11-10")).toBe("2026-11-10");
    expect(parseDateBR("31/02/2026")).toBeNull();
    expect(parseDateBR("10/13/2026")).toBeNull();
  });
});

describe("faixas fisiológicas", () => {
  const v = (k: string, x: string) => validateValue("bioimpedancia", k, x, false, TODAY);
  it("peso 20–400 kg", () => {
    expect(v("peso", "70,3")).toBeNull();
    expect(v("peso", "19,9")).toMatch(/Fora da faixa/);
    expect(v("peso", "400")).toBeNull();
    expect(v("peso", "401")).toMatch(/Fora da faixa/);
  });
  it("% de gordura 2–70", () => {
    expect(v("gordura_pct", "26,8")).toBeNull();
    expect(v("gordura_pct", "1,9")).toMatch(/Fora da faixa/);
    expect(v("gordura_pct", "71")).toMatch(/Fora da faixa/);
  });
  it("tmb e nível visceral são inteiros", () => {
    expect(v("tmb", "1420")).toBeNull();
    expect(v("tmb", "300")).toMatch(/Fora da faixa/);
    expect(v("gordura_visceral", "7,5")).toMatch(/inteiro/);
    expect(v("gordura_visceral", "31")).toMatch(/Fora da faixa/);
  });
  it("data não pode ser futura nem inválida", () => {
    expect(v("data", "10/11/2026")).toBeNull();
    expect(v("data", "17/11/2026")).toMatch(/futura/);
    expect(v("data", "32/01/2026")).toMatch(/inválida/);
  });
  it("obrigatório vazio exige preenchimento; opcional vazio passa", () => {
    expect(validateValue("bioimpedancia", "peso", "", true)).toMatch(/Preencha/);
    expect(validateValue("bioimpedancia", "agua", "", false)).toBeNull();
  });
  it("dieta e treino: horário, séries, repetições e carga", () => {
    expect(validateValue("dieta", "m0.time", "25:00", false)).toMatch(/Horário/);
    expect(validateValue("dieta", "m0.time", "07:30", false)).toBeNull();
    expect(validateValue("treino", "d0.e0.sets", "0", false)).toMatch(/Fora da faixa/);
    expect(validateValue("treino", "d0.e0.reps", "101", false)).toMatch(/Fora da faixa/);
    expect(validateValue("treino", "d0.e0.load", "20,5", false)).toBeNull();
    expect(validateValue("treino", "d0.e0.bogus", "1", false)).toMatch(/desconhecido/);
  });
  it("valor fora da faixa lido do documento vira INCERTO (mantém o valor lido)", () => {
    const f: ReadField = { key: "peso", group: null, label: "Peso", value: "7,03", unit: "kg", required: true, uncertain: false, reason: null, options: null, source: "Peso 7,03 kg", page: 1, confidence: 0.99 };
    const [out] = applyRules("bioimpedancia", [f], TODAY);
    expect(out.uncertain).toBe(true);
    expect(out.value).toBe("7,03");
    expect(out.reason).toMatch(/Fora da faixa/);
  });
  it("confiança baixa e falta de trecho de origem viram incertos; chave inventada some", () => {
    const base: ReadField = { key: "peso", group: null, label: "Peso", value: "70,3", unit: "kg", required: true, uncertain: false, reason: null, options: null, source: "Peso 70,3 kg", page: 1, confidence: 0.95 };
    expect(applyRules("bioimpedancia", [{ ...base, confidence: 0.79 }], TODAY)[0].uncertain).toBe(true);
    expect(applyRules("bioimpedancia", [{ ...base, source: null }], TODAY)[0].reason).toMatch(/origem/);
    expect(applyRules("bioimpedancia", [{ ...base, key: "diagnostico" }], TODAY)).toEqual([]);
    expect(applyRules("bioimpedancia", [base], TODAY)[0].uncertain).toBe(false);
  });
  it("massa magra + gordura que não batem com o peso ficam incertas", () => {
    const mk = (key: string, value: string): ReadField => ({ key, group: null, label: key, value, unit: null, required: false, uncertain: false, reason: null, options: null, source: "x", page: 1, confidence: 1 });
    const bad = crossCheckBio([mk("peso", "70,3"), mk("gordura_pct", "26,8"), mk("massa_magra", "60")]);
    expect(bad.filter((f) => f.uncertain).map((f) => f.key).sort()).toEqual(["gordura_pct", "massa_magra"]);
    const ok = crossCheckBio([mk("peso", "70,3"), mk("gordura_pct", "26,8"), mk("massa_magra", "51,5")]);
    expect(ok.some((f) => f.uncertain)).toBe(false);
  });
  it("o número lido precisa aparecer no texto do documento", () => {
    const f: ReadField = { key: "peso", group: null, label: "Peso", value: "99,9", unit: "kg", required: true, uncertain: false, reason: null, options: null, source: "x", page: 1, confidence: 0.99 };
    expect(verifyAgainstText([f], fx("bioimpedancia-mariana-teste"))[0].uncertain).toBe(true);
    expect(verifyAgainstText([{ ...f, value: "70,3" }], fx("bioimpedancia-mariana-teste"))[0].uncertain).toBe(false);
    expect(verifyAgainstText([{ ...f, value: "1420" }], fx("bioimpedancia-mariana-teste"))[0].uncertain).toBe(false); // "1.420" no PDF
  });
  it("nome diferente no documento gera aviso", () => {
    expect(checkPatientName(fx("bioimpedancia-mariana-teste"), "Mariana Teste")).toBeNull();
    expect(checkPatientName(fx("bioimpedancia-mariana-teste"), "Carlos Souza")).toMatch(/diferente do paciente/);
  });
});

describe("modo demonstração — bioimpedância (PDF de exemplo com texto real)", () => {
  const r = read("bioimpedancia", "bioimpedancia-mariana-teste");
  it("extrai todos os campos do exemplo, sem incerto", () => {
    expect(r.mode).toBe("demo");
    const got = Object.fromEntries(r.fields.filter((f) => f.value != null).map((f) => [f.key, f.value]));
    expect(got).toMatchObject({ data: "10/11/2026", peso: "70,3", gordura_pct: "26,8", massa_magra: "51,5", massa_muscular: "28,6", agua: "37,9", gordura_visceral: "7", tmb: "1420", cintura: "78", quadril: "99" });
    expect(r.fields.filter((f) => f.uncertain)).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
  it("cada número traz a fonte (trecho + página)", () => {
    for (const k of ["peso", "gordura_pct", "tmb", "data"]) {
      const f = val(r, k)!;
      expect(f.source).toBeTruthy();
      expect(f.page).toBe(1);
    }
    expect(val(r, "tmb")!.source).toMatch(/1\.420/);
  });
  it("não confunde 'Peso ideal', 'Controle de peso' nem a relação cintura-quadril", () => {
    expect(val(r, "peso")!.value).toBe("70,3");
    expect(val(r, "quadril")!.value).toBe("99");
  });
  it("massa de gordura em kg não vira % de gordura", () => {
    const pages = ["Data do exame: 10/11/2026\nPeso corporal 70,3 kg\nMassa de gordura corporal 18,8 kg\nPercentual de gordura 26,8 %"];
    expect(val(readDemo({ kind: "bioimpedancia", pages, isImage: false, today: TODAY }), "gordura_pct")!.value).toBe("26,8");
  });
  it("laudo ruim: data sem rótulo, dois pesos e massa magra que não bate ficam INCERTOS (laranja)", () => {
    const x = read("bioimpedancia", "bioimpedancia-mariana-incerta");
    const unc = x.fields.filter((f) => f.uncertain).map((f) => f.key).sort();
    expect(unc).toEqual(["data", "gordura_pct", "massa_magra", "peso"]);
    expect(val(x, "peso")!.options).toEqual(["70,3", "71,2"]);
    expect(val(x, "gordura_visceral")!.value).toBeNull(); // não achou: vazio, não inventa
    expect(val(x, "gordura_visceral")!.uncertain).toBe(false); // opcional
  });
  it("obrigatório não encontrado nasce vazio e incerto", () => {
    const x = readDemo({ kind: "bioimpedancia", pages: ["Relatório de teste com texto suficiente para ser lido mas sem nenhum campo conhecido aqui"], isImage: false, today: TODAY });
    for (const k of ["data", "peso", "gordura_pct"]) {
      expect(val(x, k)!.value).toBeNull();
      expect(val(x, k)!.uncertain).toBe(true);
    }
  });
  it("data futura no PDF vira incerta", () => {
    const x = readDemo({ kind: "bioimpedancia", pages: ["Data do exame: 20/12/2026\nPeso corporal 70,3 kg\nPercentual de gordura 26,8 %"], isImage: false, today: TODAY });
    expect(val(x, "data")!.uncertain).toBe(true);
    expect(val(x, "data")!.reason).toMatch(/futura/);
  });
});

describe("modo demonstração — foto e PDF sem texto", () => {
  it("foto sem chave: tudo vazio/incerto e aviso 'precisa da Vertexa IA ativa'", () => {
    const r = readDemo({ kind: "bioimpedancia", pages: null, isImage: true, today: TODAY });
    expect(r.notice).toBe(NOTICE_PHOTO_NEEDS_AI);
    expect(r.notice).toMatch(/precisa da Vertexa IA ativa/);
    expect(r.legible).toBe(false);
    expect(r.fields.every((f) => f.value == null)).toBe(true);
    expect(r.fields.filter((f) => f.required).every((f) => f.uncertain)).toBe(true);
  });
  it("dieta/treino por foto: nada lido, sem campos", () => {
    for (const kind of ["dieta", "treino"] as const) {
      const r = readDemo({ kind, pages: null, isImage: true });
      expect(r.fields).toEqual([]);
      expect(r.notice).toBe(NOTICE_PHOTO_NEEDS_AI);
    }
  });
  it("PDF escaneado (sem camada de texto) avisa e não inventa", () => {
    const r = readDemo({ kind: "bioimpedancia", pages: ["  \n "], isImage: false });
    expect(r.notice).toBe(NOTICE_NO_TEXT);
    expect(r.fields.every((f) => f.value == null)).toBe(true);
  });
  it("PDF de dieta sem nenhuma refeição: avisa, não grava nada", () => {
    const r = readDemo({ kind: "dieta", pages: ["Texto qualquer de um documento que não é um plano alimentar mas tem bastante texto"], isImage: false });
    expect(r.fields).toEqual([]);
    expect(r.notice).toMatch(/Não encontrei refeições/);
  });
});

describe("modo demonstração — dieta (PDF de exemplo, 3 refeições)", () => {
  const r = read("dieta", "dieta-mariana-teste");
  it("acha 3 refeições com horário e calorias", () => {
    expect(r.groups.map((g) => g.title)).toEqual(["Café da manhã", "Almoço", "Jantar"]);
    expect(["m0", "m1", "m2"].map((m) => val(r, `${m}.time`)!.value)).toEqual(["07:30", "12:30", "19:30"]);
    expect(["m0", "m1", "m2"].map((m) => val(r, `${m}.kcal`)!.value)).toEqual(["420", "650", "480"]);
  });
  it("itens com quantidade, e fonte em cada um", () => {
    expect(val(r, "m0.i0")).toMatchObject({ label: "Ovos mexidos", value: "2 un", uncertain: false });
    expect(val(r, "m0.i1")).toMatchObject({ label: "Pão integral", value: "50 g" });
    expect(val(r, "m1.i0")).toMatchObject({ label: "Arroz", value: "4 colheres de sopa (100 g)", uncertain: false });
    expect(val(r, "m1.i2")).toMatchObject({ value: "à vontade", uncertain: false });
    expect(val(r, "m0.i0")!.source).toMatch(/ovos mexidos/);
    expect(val(r, "m0.i0")!.page).toBe(1);
  });
  it("item sem quantidade e medida caseira sem peso ficam INCERTOS", () => {
    expect(val(r, "m0.i2")).toMatchObject({ label: "Mamão", value: null, uncertain: true });
    expect(val(r, "m0.i2")!.reason).toMatch(/não traz a quantidade/);
    expect(val(r, "m1.i3")!.uncertain).toBe(true);
    expect(val(r, "m1.i3")!.reason).toMatch(/Medida caseira/);
    expect(r.fields.filter((f) => f.uncertain).map((f) => f.key)).toEqual(["m0.i2", "m1.i3"]);
  });
  it("não leva orientações gerais para dentro de uma refeição", () => {
    expect(r.fields.some((f) => /água/i.test(f.label))).toBe(false);
  });
});

describe("modo demonstração — treino A/B (PDF de exemplo)", () => {
  const r = read("treino", "treino-mariana-teste");
  it("acha os dois dias e os exercícios", () => {
    expect(r.groups).toEqual([
      { id: "d0", title: "Treino A", subtitle: "Peito e tríceps" },
      { id: "d1", title: "Treino B", subtitle: "Costas e bíceps" },
    ]);
    expect(val(r, "d0.e0.sets")!.value).toBe("4");
    expect(val(r, "d0.e0.reps")!.value).toBe("10");
    expect(val(r, "d0.e0.load")!.value).toBe("20");
    expect(val(r, "d1.e3.load")).toMatchObject({ value: "8" });
    expect(r.fields.filter((f) => /\.sets$/.test(f.key))).toHaveLength(8);
  });
  it("faixa de repetições (8–12) vira incerto com opções; exercício sem carga fica vazio sem alarme", () => {
    expect(val(r, "d0.e1.reps")).toMatchObject({ value: null, uncertain: true, options: ["8", "10", "12"] });
    expect(val(r, "d0.e2.load")).toMatchObject({ value: null, uncertain: false });
    expect(r.fields.filter((f) => f.uncertain).map((f) => f.key)).toEqual(["d0.e1.reps"]);
  });
  it("linha que não é exercício não vira exercício, e observação/rodapé não entram em 'não entendi'", () => {
    expect(r.fields.some((f) => /descanso|documento/i.test(f.label))).toBe(false);
    expect(r.unrecognized).toEqual([]);
  });
});

describe("modo com chave — saída do modelo nunca entra crua", () => {
  const pages = fx("bioimpedancia-mariana-teste");
  const good = (over: Record<string, unknown> = {}) => ({
    groups: [],
    fields: [
      { key: "data", group: null, label: "Data", value: "10/11/2026", source: "Data do exame: 10/11/2026", page: 1, confidence: 0.97, options: null },
      { key: "peso", group: null, label: "Peso", value: "70.3", source: "Peso corporal 70,3 kg", page: 1, confidence: 0.97, options: null },
      { key: "gordura_pct", group: null, label: "% gordura", value: "26,8", source: "PGC 26,8 %", page: 1, confidence: 0.6, options: null },
      { key: "diagnostico", group: null, label: "Diagnóstico", value: "obesidade", source: "x", page: 1, confidence: 1, options: null },
      { key: "massa_magra", group: null, label: "Massa magra", value: "51,6", source: "Massa magra", page: 1, confidence: 0.99, options: null },
    ],
    unrecognized: [],
    ...over,
  });
  it("normaliza, descarta chave inventada e marca incerto o que está abaixo de 0,8 ou não está no texto", () => {
    const r = normalizeModelOutput("bioimpedancia", good(), { pages, today: TODAY, patientName: "Mariana Teste" })!;
    expect(r.mode).toBe("openai");
    expect(r.fields.some((f) => f.key === "diagnostico")).toBe(false);
    expect(val(r, "peso")).toMatchObject({ value: "70,3", uncertain: false });
    expect(val(r, "gordura_pct")).toMatchObject({ uncertain: true, reason: "Leitura com pouca certeza." });
    expect(val(r, "massa_magra")).toMatchObject({ value: "51,6", uncertain: true }); // 51,6 não está no PDF (é 51,5)
    expect(val(r, "tmb")).toMatchObject({ value: null }); // ausente: vazio, não inventa
  });
  it("sem o texto do arquivo (foto), a verificação contra o texto não se aplica", () => {
    const r = normalizeModelOutput("bioimpedancia", good(), { pages: null, today: TODAY })!;
    expect(val(r, "massa_magra")!.uncertain).toBe(false);
  });
  it("formato inválido → null (a função tenta de novo uma vez)", () => {
    expect(normalizeModelOutput("bioimpedancia", null, { pages })).toBeNull();
    expect(normalizeModelOutput("bioimpedancia", { fields: "x", groups: [] }, { pages })).toBeNull();
    expect(normalizeModelOutput("dieta", { groups: [], fields: [], unrecognized: [] }, { pages })).toBeNull();
  });
  it("valor fora da faixa vindo do modelo é incerto", () => {
    const o = good({ fields: [{ key: "peso", group: null, label: "Peso", value: "700", source: "Peso 700", page: 1, confidence: 1, options: null }] });
    expect(val(normalizeModelOutput("bioimpedancia", o, { pages: null })!, "peso")).toMatchObject({ uncertain: true });
  });
  it("dieta: item sem quantidade do modelo fica incerto; refeição inexistente é descartada", () => {
    const o = {
      groups: [{ id: "m0", title: "Café", subtitle: null }],
      fields: [
        { key: "m0.time", group: "m0", label: "Horário", value: "07:30", source: "Café 07:30", page: 1, confidence: 0.99, options: null },
        { key: "m0.i0", group: "m0", label: "Mamão", value: null, source: "Mamão", page: 1, confidence: 0.99, options: null },
        { key: "m5.i0", group: "m5", label: "Fantasma", value: "1 un", source: "x", page: 1, confidence: 0.99, options: null },
      ],
      unrecognized: [],
    };
    const r = normalizeModelOutput("dieta", o, { pages: null })!;
    expect(r.fields.map((f) => f.key)).toEqual(["m0.time", "m0.i0"]);
    expect(val(r, "m0.i0")).toMatchObject({ uncertain: true, reason: "O documento não traz a quantidade." });
  });
});

describe("quem pode ler o documento (espelho das disciplinas)", () => {
  it("bioimpedância = body_assessments; dieta = nutrition; treino = workout (mesmo mapa do painel)", () => {
    expect([...DOC_WRITE_DISCIPLINES.bioimpedancia].sort()).toEqual([...DISCIPLINE_WRITE_MAP.bodyAssessment].sort());
    expect([...DOC_WRITE_DISCIPLINES.dieta].sort()).toEqual([...DISCIPLINE_WRITE_MAP.nutrition].sort());
    expect([...DOC_WRITE_DISCIPLINES.treino].sort()).toEqual([...DISCIPLINE_WRITE_MAP.workout].sort());
  });
  it("educador físico lê treino e bioimpedância, não dieta; sem disciplina não lê nada", () => {
    expect(canReadDocFor("treino", ["educador_fisico"])).toBe(true);
    expect(canReadDocFor("bioimpedancia", ["educador_fisico"])).toBe(true);
    expect(canReadDocFor("dieta", ["educador_fisico"])).toBe(false);
    expect(canReadDocFor("dieta", ["nutricionista"])).toBe(true);
    expect(canReadDocFor("treino", ["nutricionista"])).toBe(false);
    expect(canReadDocFor("bioimpedancia", ["psicologo", "outro"])).toBe(false);
    for (const k of ["bioimpedancia", "dieta", "treino"] as const) expect(canReadDocFor(k, [])).toBe(false);
  });
  it("Recepção, Financeiro e Estoquista não têm acesso clínico (igual à Vertexa IA); admin sempre tem", () => {
    for (const roles of [["recepcao"], ["financeiro"], ["estoquista"], ["recepcao", "financeiro"]]) {
      expect(hasClinicalAccess(false, roles)).toBe(false);
      expect(hasClinicalAccess(false, roles)).toBe(hasClinicalAccessAi(false, roles));
    }
    expect(hasClinicalAccess(true, ["recepcao"])).toBe(true);
    expect(hasClinicalAccess(false, [])).toBe(true);
    expect(hasClinicalAccess(false, ["recepcao", "medico"])).toBe(true);
  });
  it("tipo real do arquivo pelo conteúdo, não pelo nome", () => {
    expect(sniffMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe("application/pdf");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(sniffMime(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // .exe com nome .pdf
  });
});

describe("a função só lê: nunca grava na ficha (guarda estática)", () => {
  const src = readFileSync(`${__dirname}/../../vertexa-doc-read/index.ts`, "utf8");
  it("não toca em tabelas/RPCs clínicas de escrita", () => {
    expect(src).not.toMatch(/body_assessments|nutrition_plans|workout_plans|weight_logs|save_nutrition_plan|save_workout_plan|patient_documents"\)\s*\.(insert|update|upsert)/);
  });
  it("recusa por papel, acesso ao paciente e disciplina ANTES de usar o arquivo (baixado só com o JWT do usuário)", () => {
    expect(src).toMatch(/hasClinicalAccess\(/);
    expect(src).toMatch(/vertexa_ai_can_access_patient/);
    expect(src).toMatch(/canReadDocFor\(/);
    // o download corre junto da autorização (desempenho), mas pelo cliente do usuário (RLS do Storage), nunca pelo admin
    expect(src).toMatch(/user\.storage\.from\(BUCKET\)\.download\(path\)/);
    expect(src).not.toMatch(/admin\.storage\.from\(BUCKET\)\.download/);
    const auth = src.indexOf("authorize(me, patientId, kind, chkP)");
    const deny = src.indexOf("if (denied) return denied;", auth);
    expect(auth).toBeGreaterThan(0);
    expect(deny).toBeGreaterThan(auth);
    expect(deny).toBeLessThan(src.indexOf("blob.arrayBuffer()"));
    expect(deny).toBeLessThan(src.indexOf("readDemo(", deny - 1));
  });
  it("o rastro não carrega valores lidos", () => {
    const insert = /from\("vertexa_doc_reads"\)\.insert\(\{[\s\S]*?\}\);/.exec(src)![0];
    expect(insert).not.toMatch(/result\.fields\s*[,.\]]\s*(map|value)|value:/);
    expect(insert).toMatch(/fields_total/);
  });
});
