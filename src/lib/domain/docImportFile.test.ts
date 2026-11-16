import { describe, expect, it } from "vitest";

import { heicToJpeg, IMPORT_MAX_BYTES, isHeic, MSG_HEIC, prepareImportFile, validateImportFile } from "./docImportFile";

const f = (name: string, type: string, size = 100) => ({ name, type, size });

describe("arquivo da importação", () => {
  it("aceita PDF, JPG, PNG e WEBP até 15 MB", () => {
    for (const [n, t] of [["a.pdf", "application/pdf"], ["a.jpg", "image/jpeg"], ["a.png", "image/png"], ["a.webp", "image/webp"]]) expect(validateImportFile(f(n, t))).toBeNull();
    expect(validateImportFile(f("a.pdf", "application/pdf", IMPORT_MAX_BYTES))).toBeNull();
  });
  it("recusa acima do limite, vazio e tipo estranho", () => {
    expect(validateImportFile(f("a.pdf", "application/pdf", IMPORT_MAX_BYTES + 1))).toMatch(/15 MB/);
    expect(validateImportFile(f("a.pdf", "application/pdf", 0))).toMatch(/vazio/);
    expect(validateImportFile(f("a.exe", "application/x-msdownload"))).toMatch(/Formato não suportado/);
    expect(validateImportFile(f("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))).toMatch(/Formato/);
  });
  it("HEIC passa na validação (é convertido depois), por tipo ou por extensão", () => {
    expect(isHeic(f("foto.HEIC", ""))).toBe(true);
    expect(isHeic(f("foto", "image/heif"))).toBe(true);
    expect(validateImportFile(f("foto.heic", "image/heic"))).toBeNull();
  });
  it("HEIC que o navegador não abre vira mensagem pedindo JPG (jsdom não decodifica)", async () => {
    await expect(heicToJpeg(new File(["x"], "foto.heic", { type: "image/heic" }))).rejects.toThrow(MSG_HEIC);
    await expect(prepareImportFile(new File(["x"], "foto.heic", { type: "image/heic" }))).rejects.toThrow(/JPG ou PNG/);
  });
  it("PDF segue sem conversão", async () => {
    const pdf = new File(["%PDF-1.4"], "a.pdf", { type: "application/pdf" });
    expect(await prepareImportFile(pdf)).toBe(pdf);
  });
});
