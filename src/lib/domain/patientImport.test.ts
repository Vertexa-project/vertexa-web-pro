import { describe, expect, it } from "vitest";

import {
  buildCandidates,
  buildImportPayload,
  buildPreview,
  canForceDuplicate,
  countPreview,
  detectDelimiter,
  detectDuplicates,
  duplicateLabel,
  importButtonLabel,
  importResultMessage,
  normalizeHeader,
  parseBirthDate,
  parseDelimited,
  parseNumberBR,
  phoneKey,
  suggestMapping,
  type ImportField,
  type RawImportRow,
} from "./patientImport";

const TODAY = "2026-11-16";

describe("parseDelimited", () => {
  it("lê CSV com ponto e vírgula (Excel BR)", () => {
    expect(parseDelimited("nome;email\nAna;ana@x.com\nBruno;b@x.com")).toEqual([
      ["nome", "email"],
      ["Ana", "ana@x.com"],
      ["Bruno", "b@x.com"],
    ]);
  });
  it("lê CSV com vírgula e detecta o separador", () => {
    expect(detectDelimiter("name,email,phone\n")).toBe(",");
    expect(parseDelimited("name,email\nAna,ana@x.com")[1]).toEqual(["Ana", "ana@x.com"]);
  });
  it("lê tabulação", () => {
    expect(parseDelimited("nome\temail\nAna\ta@x.com")[1]).toEqual(["Ana", "a@x.com"]);
  });
  it("aspas: separador dentro da célula, aspas duplas escapadas e quebra de linha dentro da célula", () => {
    const csv = 'nome;objetivo\n"Silva; Ana";"Ganhar ""massa"""\n"Souza, Bia";"linha 1\nlinha 2"\n';
    expect(parseDelimited(csv)).toEqual([
      ["nome", "objetivo"],
      ["Silva; Ana", 'Ganhar "massa"'],
      ["Souza, Bia", "linha 1\nlinha 2"],
    ]);
  });
  it("tira o BOM do UTF-8 e aceita \\r\\n", () => {
    expect(parseDelimited("\uFEFFnome;email\r\nAna;a@x.com\r\n")).toEqual([
      ["nome", "email"],
      ["Ana", "a@x.com"],
    ]);
  });
  it("descarta linhas totalmente vazias e mantém células vazias no meio", () => {
    expect(parseDelimited("a;b;c\n\n1;;3\n;;\n")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });
  it("célula que começa com = + - @ continua texto (nada é avaliado)", () => {
    expect(parseDelimited("nome\n=1+1\n@SOMA(A1)")[1][0]).toBe("=1+1");
  });
});

describe("suggestMapping", () => {
  const map = (h: string[]) => suggestMapping(h);
  it("cabeçalhos do Dietbox em português, com acento e pontuação", () => {
    expect(map(["Nome do Paciente", "E-mail", "Celular", "Data de Nascimento", "Sexo", "Objetivo", "Peso (kg)", "Altura (cm)"])).toEqual([
      "name", "email", "phone", "birth_date", "sex", "goal", "weight_kg", "height_cm",
    ]);
  });
  it("cabeçalhos do WebDiet e variações abreviadas", () => {
    expect(map(["Paciente", "Email", "WhatsApp", "Dt. Nasc.", "Gênero", "Meta", "Peso Atual", "Estatura"])).toEqual([
      "name", "email", "phone", "birth_date", "sex", "goal", "weight_kg", "height_cm",
    ]);
  });
  it("cabeçalhos em inglês", () => {
    expect(map(["Full Name", "Email Address", "Phone", "Birth Date", "Gender", "Goal", "Weight", "Height"])).toEqual([
      "name", "email", "phone", "birth_date", "sex", "goal", "weight_kg", "height_cm",
    ]);
  });
  it("coluna sem campo (grupo) fica nula e cada campo liga a uma coluna só (a primeira)", () => {
    expect(map(["grupo", "nome", "Nome completo", "email"])).toEqual([null, "name", null, "email"]);
  });
  it("normalizeHeader tira acento, caixa e pontuação", () => {
    expect(normalizeHeader(" Data de Nasc. ")).toBe("datadenasc");
    expect(normalizeHeader("Observações")).toBe("observacoes");
  });
});

describe("campos", () => {
  it("telefone: só dígitos, sem 55; 10 ou 11 dígitos", () => {
    expect(phoneKey("(17) 9 9812-3344")).toBe("17998123344");
    expect(phoneKey("+55 17 99812-3344")).toBe("17998123344");
    expect(phoneKey("(17) 3812-3344")).toBe("1738123344");
    expect(phoneKey("9999-12")).toBeNull();
    expect(phoneKey("")).toBeNull();
  });
  it("data de nascimento: dd/mm/aaaa, ISO, não aceita futura, 30/02, nem ano de 2 dígitos", () => {
    expect(parseBirthDate("10/05/1990", TODAY)).toBe("1990-05-10");
    expect(parseBirthDate("1990-05-10", TODAY)).toBe("1990-05-10");
    expect(parseBirthDate("1990-05-10T00:00:00", TODAY)).toBe("1990-05-10");
    expect(parseBirthDate("5-1-1985", TODAY)).toBe("1985-01-05");
    expect(parseBirthDate("30/02/1990", TODAY)).toBeNull();
    expect(parseBirthDate("17/11/2026", TODAY)).toBeNull();
    expect(parseBirthDate("10/05/90", TODAY)).toBeNull();
    expect(parseBirthDate("abc", TODAY)).toBeNull();
    expect(parseBirthDate("16/11/2026", TODAY)).toBe("2026-11-16");
  });
  it("números pt-BR: vírgula decimal, ponto de milhar, unidade", () => {
    expect(parseNumberBR("70,5")).toBe(70.5);
    expect(parseNumberBR("70.5")).toBe(70.5);
    expect(parseNumberBR("1.070,5")).toBe(1070.5);
    expect(parseNumberBR("70,5 kg")).toBe(70.5);
    expect(parseNumberBR("165 cm")).toBe(165);
    expect(parseNumberBR("setenta")).toBeNull();
  });
});

const rows = (list: string[][]): RawImportRow[] => list.map((cells, i) => ({ line: i + 2, cells }));
const MAP: (ImportField | null)[] = ["name", "email", "phone", "birth_date", "sex", "goal", "weight_kg", "height_cm"];

describe("buildCandidates", () => {
  it("linha boa vira valores normalizados (e-mail minúsculo, peso 70,5, altura em m vira cm, sexo canônico)", () => {
    const [c] = buildCandidates(
      rows([["  Ana   Souza ", "ANA@X.COM", "(17) 99812-3344", "10/05/1990", "F", "Emagrecimento", "70,5", "1,65"]]),
      MAP,
      TODAY,
    );
    expect(c.errors).toEqual([]);
    expect(c.values).toEqual({
      name: "Ana Souza", email: "ana@x.com", phone: "(17) 99812-3344", birth_date: "1990-05-10",
      sex: "feminino", goal: "Emagrecimento", weight_kg: 70.5, height_cm: 165,
    });
  });
  it("erros: nome vazio, e-mail inválido, data inválida, telefone inválido, sexo, peso e altura", () => {
    const out = buildCandidates(
      rows([
        ["", "a@x.com", "", "", "", "", "", ""],
        ["Bia", "bia-sem-arroba", "", "", "", "", "", ""],
        ["Caio", "", "", "31/02/2000", "", "", "", ""],
        ["Davi", "", "9999-12", "", "", "", "", ""],
        ["Eva", "", "", "", "talvez", "", "5", "400"],
      ]),
      MAP,
      TODAY,
    );
    expect(out[0].errors).toEqual(["Nome vazio"]);
    expect(out[1].errors).toEqual(["E-mail inválido"]);
    expect(out[2].errors).toEqual(["Data de nascimento inválida"]);
    expect(out[3].errors).toEqual(["Telefone inválido"]);
    expect(out[4].errors).toEqual(["Sexo inválido", "Peso inválido", "Altura inválida"]);
  });
  it("só nome é obrigatório; campo não ligado fica vazio", () => {
    const [c] = buildCandidates(rows([["Só Nome"]]), ["name"], TODAY);
    expect(c.errors).toEqual([]);
    expect(c.values.email).toBeNull();
    expect(c.values.weight_kg).toBeNull();
  });
});

describe("detectDuplicates", () => {
  const cands = (list: string[][]) => buildCandidates(rows(list), MAP, TODAY);
  it("mesmo e-mail já na clínica (sem diferenciar caixa)", () => {
    const d = detectDuplicates(cands([["Outra", "MARIANA@x.com", "", "", "", "", "", ""]]), [
      { email: "mariana@x.com", name: "Mariana", birth_date: null, phone_key: null },
    ]);
    expect(d.get(2)).toEqual({ reason: "email", where: "clinica" });
  });
  it("mesmo telefone já na clínica (máscara e +55 não importam)", () => {
    const d = detectDuplicates(cands([["Fulana", "", "+55 (17) 99812-3344", "", "", "", "", ""]]), [
      { email: null, name: "Beatriz", birth_date: null, phone_key: "17998123344" },
    ]);
    expect(d.get(2)).toMatchObject({ reason: "telefone", where: "clinica" });
  });
  it("mesmo nome + nascimento já na clínica (sem acento, sem caixa)", () => {
    const d = detectDuplicates(cands([["JOÃO  da Silva", "", "", "01/02/1980", "", "", "", ""]]), [
      { email: null, name: "Joao da silva", birth_date: "1980-02-01", phone_key: null },
    ]);
    expect(d.get(2)).toMatchObject({ reason: "nome_nascimento", where: "clinica" });
  });
  it("mesmo nome sem nascimento NÃO é duplicado (homônimos)", () => {
    const d = detectDuplicates(cands([["Maria Silva", "", "", "", "", "", "", ""]]), [
      { email: null, name: "Maria Silva", birth_date: "1980-02-01", phone_key: null },
    ]);
    expect(d.size).toBe(0);
  });
  it("repetido no arquivo: a primeira ocorrência vale, as seguintes apontam a linha", () => {
    const d = detectDuplicates(
      cands([
        ["Ana", "ana@x.com", "", "", "", "", "", ""],
        ["Ana B", "ana@x.com", "", "", "", "", "", ""],
        ["Carla", "", "17 99999-1111", "", "", "", "", ""],
        ["Carla M", "", "(17) 99999-1111", "", "", "", "", ""],
      ]),
      [],
    );
    expect(d.get(2)).toBeUndefined();
    expect(d.get(3)).toEqual({ reason: "email", where: "arquivo", otherLine: 2 });
    expect(d.get(5)).toEqual({ reason: "telefone", where: "arquivo", otherLine: 4 });
    expect(duplicateLabel(d.get(3)!)).toBe("Mesmo e-mail da linha 2 deste arquivo");
  });
  it("linha com erro não conta como primeira ocorrência nem vira duplicada", () => {
    const d = detectDuplicates(
      cands([
        ["", "dup@x.com", "", "", "", "", "", ""],
        ["Boa", "dup@x.com", "", "", "", "", "", ""],
      ]),
      [],
    );
    expect(d.size).toBe(0);
  });
  it("e-mail nunca pode ser forçado; telefone e nome+nascimento podem", () => {
    expect(canForceDuplicate({ reason: "email", where: "clinica" })).toBe(false);
    expect(canForceDuplicate({ reason: "telefone", where: "arquivo", otherLine: 2 })).toBe(true);
    expect(canForceDuplicate({ reason: "nome_nascimento", where: "clinica" })).toBe(true);
  });
});

describe("prévia e envio", () => {
  const list = [
    ["Marina", "marina@x.com", "", "", "", "", "", ""],
    ["Bruno", "bruno@x.com", "", "", "", "", "", ""],
    ["", "erro@x.com", "", "", "", "", "", ""],
    ["Beatriz", "beatriz@x.com", "", "", "", "", "", ""],
    ["Carla", "", "(17) 99812-3344", "", "", "", "", ""],
  ];
  const candidates = buildCandidates(rows(list), MAP, TODAY);
  const dups = detectDuplicates(candidates, [
    { email: "beatriz@x.com", name: "Beatriz", birth_date: null, phone_key: null },
    { email: null, name: "Outra", birth_date: null, phone_key: "17998123344" },
  ]);
  const preview = buildPreview(candidates, dups);

  it("status por linha e contagem", () => {
    expect(preview.map((p) => p.status)).toEqual(["pronto", "pronto", "erro", "duplicado", "duplicado"]);
    expect(countPreview(preview, new Set())).toEqual({ ready: 2, errors: 1, duplicates: 2, forcedCount: 0, toImport: 2 });
  });
  it("duplicado fica de fora por padrão; só entra se for liberável e a pessoa liberar; erro nunca", () => {
    expect(buildImportPayload(preview, new Set()).map((r) => r.line)).toEqual([2, 3]);
    const payload = buildImportPayload(preview, new Set([4, 5, 6]));
    expect(payload.map((r) => [r.line, r.force])).toEqual([[2, false], [3, false], [6, true]]);
    expect(countPreview(preview, new Set([4, 5, 6])).toImport).toBe(3);
  });
  it("textos: botão e resultado no singular/plural", () => {
    expect(importButtonLabel(3)).toBe("Importar 3 pacientes");
    expect(importButtonLabel(1)).toBe("Importar 1 paciente");
    expect(importResultMessage({ imported: 3, duplicates: 1, errors: 0 })).toBe("3 pacientes importados. 1 duplicado ficou de fora.");
    expect(importResultMessage({ imported: 1, duplicates: 2, errors: 1 })).toBe("1 paciente importado. 2 duplicados ficaram de fora. 1 linha com erro não entrou.");
  });
});
