import { describe, expect, it } from "vitest";

import { NO_FIN_ACCESS } from "./finAccess";
import {
  buildExportCsv,
  canExportPatientBase,
  exportFilename,
  safeCsvText,
  validateExportRequest,
  type ExportRow,
} from "./patientExport";

const row = (o: ExportRow): ExportRow => ({ nome: "Ana Souza", ...o });

describe("buildExportCsv", () => {
  const rows: ExportRow[] = [
    row({
      nascimento: "1990-05-10", sexo: "feminino", objetivo: "Emagrecimento; sem glúten", inicio: "2026-11-02", origem: "pacientes_dietbox.csv",
      email: "ana@x.com", telefone: "(17) 99812-3344",
      altura_cm: 165, peso_inicial: 70.5, peso_atual: 68.2, meta_peso: 62, ultima_medida: "2026-11-10",
      status: "em_acompanhamento", pontuacao: 82, adesao_semanal: 75,
    }),
  ];
  it("UTF-8 com BOM, separador ';', CRLF e vírgula decimal", () => {
    const csv = buildExportCsv(["cadastro", "contato", "medidas", "adesao"], rows);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [head, line] = csv.slice(1).split("\r\n");
    expect(head).toBe(
      "Nome;Nascimento;Sexo;Objetivo;Início do acompanhamento;Origem;E-mail;Telefone;Altura (cm);Peso inicial (kg);Peso atual (kg);Meta de peso (kg);Data da última medida;Status;Pontuação;Adesão da semana (%)",
    );
    expect(line).toBe(
      'Ana Souza;10/05/1990;Feminino;"Emagrecimento; sem glúten";02/11/2026;Importado de pacientes_dietbox.csv;ana@x.com;(17) 99812-3344;165;70,5;68,2;62;10/11/2026;Em acompanhamento;82;75',
    );
  });
  it("só traz as colunas dos grupos escolhidos (nome sempre)", () => {
    const csv = buildExportCsv(["contato"], rows);
    expect(csv.slice(1).split("\r\n")[0]).toBe("Nome;E-mail;Telefone");
    expect(csv).not.toMatch(/Peso|Nascimento|Status/);
  });
  it("nunca tem coluna de prontuário e valores vazios ficam vazios", () => {
    const csv = buildExportCsv(["cadastro", "contato", "medidas", "adesao"], [row({})]);
    expect(csv).not.toMatch(/prontu/i);
    expect(csv.slice(1).split("\r\n")[1]).toBe("Ana Souza;;;;;;;;;;;;;;;");
  });
  it("texto que começa com = + - @ não vira fórmula na planilha; telefone com + é preservado", () => {
    expect(safeCsvText("=1+1")).toBe("'=1+1");
    expect(safeCsvText("@SOMA(A1)")).toBe("'@SOMA(A1)");
    expect(safeCsvText("-2+3")).toBe("'-2+3");
    expect(safeCsvText("+55 17 99812-3344")).toBe("+55 17 99812-3344");
    expect(safeCsvText("Ana")).toBe("Ana");
    const csv = buildExportCsv(["cadastro"], [row({ nome: "=HYPERLINK(\"x\")", objetivo: "+cmd" })]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+cmd");
  });
  it("nome do arquivo com a data de Brasília", () => {
    expect(exportFilename("2026-11-16")).toBe("pacientes_vertexa_2026-11-16.csv");
  });
});

describe("validateExportRequest", () => {
  const ok = { groups: ["cadastro" as const], kind: "backup" as const, reason: "Backup mensal" };
  it("aceita pedido completo", () => expect(validateExportRequest(ok)).toBeNull());
  it("exige grupo, tipo de motivo e texto do motivo (5 a 300 letras)", () => {
    expect(validateExportRequest({ ...ok, groups: [] })).toMatch(/ao menos um grupo/);
    expect(validateExportRequest({ ...ok, kind: "" })).toMatch(/Escolha o motivo/);
    expect(validateExportRequest({ ...ok, reason: "  abc " })).toMatch(/mínimo de 5/);
    expect(validateExportRequest({ ...ok, reason: "abcde" })).toBeNull();
    expect(validateExportRequest({ ...ok, reason: "x".repeat(300) })).toBeNull();
    expect(validateExportRequest({ ...ok, reason: "x".repeat(301) })).toMatch(/300/);
  });
});

describe("canExportPatientBase", () => {
  const role = (r: "gestor" | "financeiro" | "recepcao" | "estoquista") => ({ ...NO_FIN_ACCESS, roles: [{ role: r, allUnits: true, unitIds: [] }] });
  it("admin e Gestor exportam", () => {
    expect(canExportPatientBase({ ...NO_FIN_ACCESS, isAdmin: true })).toBe(true);
    expect(canExportPatientBase(role("gestor"))).toBe(true);
  });
  it("Financeiro, Recepção, Estoquista e quem não tem papel não exportam", () => {
    expect(canExportPatientBase(role("financeiro"))).toBe(false);
    expect(canExportPatientBase(role("recepcao"))).toBe(false);
    expect(canExportPatientBase(role("estoquista"))).toBe(false);
    expect(canExportPatientBase(NO_FIN_ACCESS)).toBe(false);
  });
});
