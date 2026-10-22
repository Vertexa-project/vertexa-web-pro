import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { buildZip, zipEntryName } from "./batchZip";

describe("lote em ZIP", () => {
  it("nome do arquivo: sem acento, minúsculo, e nunca repete", () => {
    const used = new Set<string>();
    expect(zipEntryName("Maria José Antônio", used)).toBe("relatorio-maria-jose-antonio.pdf");
    expect(zipEntryName("Maria José Antônio", used)).toBe("relatorio-maria-jose-antonio-2.pdf");
    expect(zipEntryName("Maria José Antônio", used)).toBe("relatorio-maria-jose-antonio-3.pdf");
    expect(zipEntryName("   ", used)).toBe("relatorio-paciente.pdf");
  });
  it("o ZIP devolve exatamente os arquivos entregues, com o conteúdo intacto", () => {
    const a = new TextEncoder().encode("%PDF-A"); const b = new TextEncoder().encode("%PDF-B");
    const out = unzipSync(buildZip([{ name: "a.pdf", data: a }, { name: "b.pdf", data: b }]));
    expect(Object.keys(out).sort()).toEqual(["a.pdf", "b.pdf"]);
    expect(new TextDecoder().decode(out["a.pdf"])).toBe("%PDF-A");
    expect(new TextDecoder().decode(out["b.pdf"])).toBe("%PDF-B");
  });
  it("lote vazio gera ZIP vazio válido", () => {
    expect(Object.keys(unzipSync(buildZip([])))).toEqual([]);
  });
});
