import { describe, expect, it } from "vitest";

import { agreementsDraft } from "./agreements";
import { buildEncounterPdfData, encounterPdfFilename, splitLines } from "./pdfModel";
import { professionalSectionValues } from "./display";
import { DEFAULT_SECTIONS } from "../../../supabase/functions/_shared/clinical/template";

const people = { professional: "Dra. Teste", registry: "CRM 123", specialty: null, type: "other", addenda: [] };

describe("PDF do atendimento", () => {
  const fields = {
    "objetivo.queixa_principal": { value: "Cansaço\nInchaço", sources: [1], locked: false },
    "objetivo.objetivo_principal": { value: "   ", sources: [], locked: false },
    "profissional.nome": { value: "não deve sair", sources: [], locked: true },
  };
  const data = buildEncounterPdfData({
    patientName: "Mariana Teste",
    clinicName: "Clínica",
    sections: DEFAULT_SECTIONS,
    fields,
    people,
    startedAt: "2026-11-13T14:00:00.000Z",
    finalizedAt: null,
    demo: true,
    addenda: [{ id: "a", text: "Adendo", created_at: "2026-11-14T10:00:00.000Z", author: "Dra. Teste" }],
    now: new Date("2026-11-14T12:00:00.000Z"),
  });
  it("omite campo vazio, seção vazia e seção de sistema; mantém linhas", () => {
    expect(data.sections.map((s) => s.title)).toEqual(["Motivo da consulta e objetivo"]);
    expect(data.sections[0].rows).toEqual([{ label: "Queixa principal (frase do paciente)", lines: ["Cansaço", "Inchaço"] }]);
    expect(data.demo).toBe(true);
    expect(data.addenda[0].author).toBe("Dra. Teste");
  });
  it("seção Profissional vem do sistema (nome, conselho, data/hora)", () => {
    const rows = professionalSectionValues(people, "2026-11-13T14:00:00.000Z");
    expect(rows.map((r) => r.label)).toEqual(["Nome", "Conselho e número", "Data e hora do atendimento"]);
    expect(rows[1].value).toBe("CRM 123");
    expect(professionalSectionValues(null, "2026-11-13T14:00:00.000Z")[1].value).toBe("Não informado no cadastro");
  });
  it("nome do arquivo e linhas", () => {
    expect(encounterPdfFilename("Mariana Çosta", "2026-11-13T14:00:00Z")).toBe("prontuario-mariana-costa-2026-11-13.pdf");
    expect(splitLines(" a \n\n b ")).toEqual(["a", "b"]);
  });
  it("texto dos combinados = combinados + retorno", () => {
    expect(
      agreementsDraft({
        "combinados.combinados": { value: "Enviar exames", sources: [], locked: false },
        "retorno.prazo_retorno": { value: "Em 30 dias.", sources: [], locked: false },
      }),
    ).toBe("Enviar exames\n\nPróximo retorno: Em 30 dias.");
    expect(agreementsDraft({})).toBe("");
  });
});
