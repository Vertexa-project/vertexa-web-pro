import { describe, expect, it } from "vitest";

import {
  AVATAR_MAX_ORIGINAL_BYTES,
  looksLikeAllowedImage,
  validateAvatarImageMeta,
} from "./validateImage";

function file(name: string, type: string, size: number): { name: string; type: string; size: number } {
  return { name, type, size };
}

describe("validateAvatarImageMeta", () => {
  it("aceita JPEG/PNG/WEBP dentro do limite", () => {
    expect(validateAvatarImageMeta(file("a.jpg", "image/jpeg", 1024))).toBeNull();
    expect(validateAvatarImageMeta(file("a.png", "image/png", 1024))).toBeNull();
    expect(validateAvatarImageMeta(file("a.webp", "image/webp", 1024))).toBeNull();
  });

  it("recusa SVG, GIF, HEIC, HTML e executável com mensagem amigável", () => {
    expect(validateAvatarImageMeta(file("x.svg", "image/svg+xml", 10))).toMatch(/Formato não suportado/);
    expect(validateAvatarImageMeta(file("x.gif", "image/gif", 10))).toMatch(/Formato não suportado/);
    expect(validateAvatarImageMeta(file("x.heic", "image/heic", 10))).toMatch(/Formato não suportado/);
    expect(validateAvatarImageMeta(file("x.html", "text/html", 10))).toMatch(/Formato não suportado/);
    expect(validateAvatarImageMeta(file("x.exe", "application/octet-stream", 10))).toMatch(
      /Formato não suportado/,
    );
  });

  it("recusa acima de 8 MB; aceita exatamente 8 MB", () => {
    expect(validateAvatarImageMeta(file("a.jpg", "image/jpeg", AVATAR_MAX_ORIGINAL_BYTES))).toBeNull();
    expect(
      validateAvatarImageMeta(file("a.jpg", "image/jpeg", AVATAR_MAX_ORIGINAL_BYTES + 1)),
    ).toMatch(/Arquivo muito grande/);
  });

  it("não confia só na extensão: MIME image/svg+xml com nome .png é recusado", () => {
    expect(validateAvatarImageMeta(file("foto.png", "image/svg+xml", 20))).toMatch(
      /Formato não suportado/,
    );
  });
});

describe("looksLikeAllowedImage (magic bytes)", () => {
  it("reconhece JPEG, PNG e WEBP", () => {
    expect(looksLikeAllowedImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(
      looksLikeAllowedImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe(true);
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(looksLikeAllowedImage(webp)).toBe(true);
  });

  it("recusa SVG/HTML/GIF mesmo com poucos bytes", () => {
    expect(looksLikeAllowedImage(new TextEncoder().encode("<svg"))).toBe(false);
    expect(looksLikeAllowedImage(new TextEncoder().encode("<!DOCTYPE html"))).toBe(false);
    expect(looksLikeAllowedImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe(false);
  });
});
