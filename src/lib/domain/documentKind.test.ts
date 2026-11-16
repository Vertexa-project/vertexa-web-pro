import { describe, expect, it } from "vitest";
import { inferDocumentKind } from "./documentKind";

describe("inferDocumentKind", () => {
  it("relatório de progresso/evolução/pontos => report (antes: Exame)", () => {
    for (const n of ["evolucao-ana-2026-11-12.pdf", "Relatório de progresso.pdf", "pontos-ana-2026-11-12.pdf", "relatorio_mensal.pdf"]) expect(inferDocumentKind(n)).toBe("report");
  });
  it("exames conhecidos => exam; sem pista => other (nunca chuta Exame)", () => {
    expect(inferDocumentKind("Hemograma e ferritina.pdf")).toBe("exam");
    expect(inferDocumentKind("scan0001.jpg")).toBe("other");
    expect(inferDocumentKind(null)).toBe("other");
  });
});
