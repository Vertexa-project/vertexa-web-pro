import { describe, expect, it } from "vitest";

import { canSendKind, deliveryFileName, deliveryStatus, deliveryStatusText, deliveryTitle, pdfBrandOf, sendErrorMessage, type DeliveryKind } from "./deliveries";
import { derivePermissions } from "./disciplines";

describe("enviar ao paciente: permissão por papel", () => {
  const nutri = derivePermissions(["nutricionista"]);
  const edu = derivePermissions(["educador_fisico"]);
  const none = derivePermissions([]);
  const matrix: Array<[string, ReturnType<typeof derivePermissions>, boolean, Record<DeliveryKind, boolean>]> = [
    ["nutricionista", nutri, true, { treino: false, plano_alimentar: true, documento: true, relatorio: true }],
    ["educador físico", edu, true, { treino: true, plano_alimentar: false, documento: true, relatorio: true }],
    ["profissional sem disciplina", none, true, { treino: false, plano_alimentar: false, documento: true, relatorio: true }],
    ["quem não é profissional (recepção sem ficha)", edu, false, { treino: false, plano_alimentar: false, documento: false, relatorio: false }],
  ];
  it.each(matrix)("%s", (_n, perms, isPro, expected) => {
    for (const kind of Object.keys(expected) as DeliveryKind[]) expect(canSendKind(kind, perms, isPro)).toBe(expected[kind]);
  });
});

describe("enviar ao paciente: nome, título e estado", () => {
  it("nome do arquivo sem acento e com a data de Brasília", () => {
    expect(deliveryFileName("treino", "Mariana Teste (QA)", new Date("2026-11-17T01:30:00Z"))).toBe("treino-mariana-teste-qa-2026-11-16.pdf");
    expect(deliveryFileName("plano_alimentar", "João Á", new Date("2026-11-16T15:00:00Z"))).toBe("plano-alimentar-joao-a-2026-11-16.pdf");
  });
  it("título que o paciente lê", () => {
    expect(deliveryTitle("treino", "Ficha de teste (QA)")).toBe("Treino · Ficha de teste (QA)");
    expect(deliveryTitle("plano_alimentar", " ")).toBe("Plano alimentar");
  });
  it("estado do envio: no app, visto, retirado, não enviado (datas de Brasília)", () => {
    const d = { sent_at: "2026-11-17T01:30:00Z", first_opened_at: null, revoked_at: null };
    expect(deliveryStatus(null)).toBe("nao_enviado");
    expect(deliveryStatus(d)).toBe("no_app");
    expect(deliveryStatusText(d)).toBe("Enviado em 16/11/2026");
    expect(deliveryStatusText({ ...d, first_opened_at: "2026-11-18T12:00:00Z" })).toBe("Enviado em 16/11/2026 · visto em 18/11/2026");
    expect(deliveryStatus({ ...d, revoked_at: "2026-11-19T12:00:00Z" })).toBe("retirado");
    expect(deliveryStatusText({ ...d, revoked_at: "2026-11-19T12:00:00Z" })).toBe("Retirado do app em 19/11/2026");
    expect(deliveryStatusText(undefined)).toBe("Não enviado");
  });
  it("erro de permissão fala a disciplina; outro erro é genérico", () => {
    expect(sendErrorMessage({ code: "42501" }, "plano_alimentar")).toBe("Requer a disciplina Nutricionista.");
    expect(sendErrorMessage(new Error("x"), "treino")).toBe("Não foi possível enviar ao paciente. Tente novamente.");
  });
});

describe("PDF com a marca da clínica", () => {
  it("nome sempre; logo se houver; cor só se for hex válido", () => {
    expect(pdfBrandOf({ name: " Clínica Ápice ", color: "11764a", logoUri: "data:image/png;base64,AA" })).toEqual({ clinicName: "Clínica Ápice", color: "#11764A", logoUri: "data:image/png;base64,AA" });
    expect(pdfBrandOf({ name: null, color: "azul", logoUri: null })).toEqual({ clinicName: "Clínica", color: null, logoUri: null });
  });
});
