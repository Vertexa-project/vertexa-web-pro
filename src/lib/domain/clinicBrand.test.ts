import { describe, expect, it } from "vitest";
import { brandInitials, buildLogoPath, fitWithin, logoPublicUrl, normalizeHexColor, validateLogoFile } from "./clinicBrand";

const CL = "0f8b2c4e-1a2b-4c3d-8e9f-0123456789ab";

describe("clinicBrand", () => {
  it("valida tipo e tamanho da logo", () => {
    expect(validateLogoFile({ type: "image/png", size: 1000 })).toBeNull();
    expect(validateLogoFile({ type: "image/webp", size: 2 * 1024 * 1024 })).toBeNull();
    expect(validateLogoFile({ type: "image/svg+xml", size: 1000 })).toMatch(/PNG, JPG ou WebP/);
    expect(validateLogoFile({ type: "application/pdf", size: 1000 })).toMatch(/PNG, JPG ou WebP/);
    expect(validateLogoFile({ type: "image/png", size: 2 * 1024 * 1024 + 1 })).toMatch(/2 MB/);
    expect(validateLogoFile({ type: "image/png", size: 0 })).toMatch(/vazio/);
  });
  it("normaliza cor hexadecimal ou recusa", () => {
    expect(normalizeHexColor("#1a2b3c")).toBe("#1A2B3C");
    expect(normalizeHexColor(" 1A2B3C ")).toBe("#1A2B3C");
    for (const bad of ["", null, undefined, "red", "#12345", "#1234567", "#GGGGGG"]) expect(normalizeHexColor(bad as string)).toBeNull();
  });
  it("caminho da logo fica na pasta da clínica e é PNG", () => {
    expect(buildLogoPath(CL.toUpperCase(), "a".repeat(16))).toBe(`${CL}/${"a".repeat(16)}.png`);
    expect(() => buildLogoPath("../x", "a".repeat(16))).toThrow();
    expect(() => buildLogoPath(CL, "xyz")).toThrow();
  });
  it("URL pública só existe com caminho", () => {
    expect(logoPublicUrl("https://x.supabase.co/", `${CL}/a.png`)).toBe(`https://x.supabase.co/storage/v1/object/public/clinic-logos/${CL}/a.png`);
    expect(logoPublicUrl("https://x.supabase.co", null)).toBeNull();
  });
  it("iniciais de fallback", () => {
    expect(brandInitials("Clínica Teste Hefesto")).toBe("CT");
    expect(brandInitials("  nutri  ")).toBe("N");
    expect(brandInitials("")).toBe("?");
    expect(brandInitials(null)).toBe("?");
  });
  it("redimensiona mantendo proporção e sem ampliar", () => {
    expect(fitWithin(1024, 512, 512)).toEqual({ width: 512, height: 256 });
    expect(fitWithin(200, 100, 512)).toEqual({ width: 200, height: 100 });
    expect(fitWithin(0, 10, 512)).toEqual({ width: 0, height: 0 });
  });
});
