import { describe, expect, it } from "vitest";

import { clampPan, sourceCropRect } from "./cropGeometry";

describe("sourceCropRect", () => {
  it("em imagem quadrada zoom 1 sem pan, recorta a imagem inteira", () => {
    const r = sourceCropRect({
      imageWidth: 1000,
      imageHeight: 1000,
      viewport: 320,
      zoom: 1,
      panX: 0,
      panY: 0,
    });
    expect(r.s).toBeCloseTo(1000, 5);
    expect(r.sx).toBeCloseTo(0, 5);
    expect(r.sy).toBeCloseTo(0, 5);
  });

  it("em paisagem, o lado menor define o quadrado central (cover)", () => {
    const r = sourceCropRect({
      imageWidth: 2000,
      imageHeight: 1000,
      viewport: 320,
      zoom: 1,
      panX: 0,
      panY: 0,
    });
    expect(r.s).toBeCloseTo(1000, 5);
    expect(r.sx).toBeCloseTo(500, 5);
    expect(r.sy).toBeCloseTo(0, 5);
  });

  it("zoom 2 reduz o lado do recorte à metade", () => {
    const r = sourceCropRect({
      imageWidth: 1000,
      imageHeight: 1000,
      viewport: 320,
      zoom: 2,
      panX: 0,
      panY: 0,
    });
    expect(r.s).toBeCloseTo(500, 5);
    expect(r.sx).toBeCloseTo(250, 5);
    expect(r.sy).toBeCloseTo(250, 5);
  });

  it("o retângulo permanece dentro da imagem", () => {
    const r = sourceCropRect({
      imageWidth: 800,
      imageHeight: 600,
      viewport: 280,
      zoom: 3,
      panX: 1,
      panY: -1,
    });
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sy).toBeGreaterThanOrEqual(0);
    expect(r.sx + r.s).toBeLessThanOrEqual(800 + 1e-6);
    expect(r.sy + r.s).toBeLessThanOrEqual(600 + 1e-6);
  });
});

describe("clampPan", () => {
  it("limita pan a [-1, 1]", () => {
    expect(clampPan(2)).toBe(1);
    expect(clampPan(-4)).toBe(-1);
    expect(clampPan(0.3)).toBeCloseTo(0.3);
  });
});
