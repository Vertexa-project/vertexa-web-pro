import { describe, expect, it } from "vitest";

import {
  buildPairs,
  comparablePoses,
  groupByPose,
  photoStorageKey,
  poseKey,
  sortAsc,
  validatePhotoDate,
  validatePhotoFile,
} from "./photoPose";

const ph = (id: string, taken_at: string | null, pose?: string | null) => ({ id, taken_at, pose });

describe("poseKey / sortAsc / groupByPose", () => {
  it("posição inválida ou ausente cai em 'none' (nunca inventa posição)", () => {
    expect(poseKey({ pose: "front" })).toBe("front");
    expect(poseKey({ pose: null })).toBe("none");
    expect(poseKey({})).toBe("none");
    expect(poseKey({ pose: "diagonal" })).toBe("none");
  });
  it("ordena do mais antigo ao mais novo, estável, e sem data vai para o fim", () => {
    const r = sortAsc([ph("c", "2026-03-01"), ph("x", null), ph("a", "2026-01-01"), ph("b", "2026-01-01")]);
    expect(r.map((p) => p.id)).toEqual(["a", "b", "c", "x"]);
  });
  it("agrupa por posição já em ordem cronológica", () => {
    const g = groupByPose([ph("1", "2026-03-01", "front"), ph("2", "2026-01-01", "front"), ph("3", "2026-02-01", "back"), ph("4", "2026-02-02")]);
    expect(g.front.map((p) => p.id)).toEqual(["2", "1"]);
    expect(g.back.map((p) => p.id)).toEqual(["3"]);
    expect(g.side).toEqual([]);
    expect(g.none.map((p) => p.id)).toEqual(["4"]);
  });
});

describe("buildPairs — só compara posições equivalentes", () => {
  it("um par por posição: mais antiga × mais recente DA MESMA posição (nunca frente × costas)", () => {
    const pairs = buildPairs([
      ph("f1", "2026-01-01", "front"),
      ph("b1", "2026-01-02", "back"),
      ph("f2", "2026-03-01", "front"),
      ph("b2", "2026-03-02", "back"),
      ph("f3", "2026-02-01", "front"),
    ]);
    expect(pairs.map((p) => [p.pose, p.before?.id, p.after.id])).toEqual([
      ["front", "f1", "f2"],
      ["back", "b1", "b2"],
    ]);
  });
  it("posição com uma foto só: sem 'antes'", () => {
    const pairs = buildPairs([ph("s1", "2026-01-01", "side")]);
    expect(pairs).toEqual([{ pose: "side", before: null, after: ph("s1", "2026-01-01", "side") }]);
  });
  it("fotos antigas sem posição formam o grupo 'none' (comportamento anterior preservado), por último", () => {
    const pairs = buildPairs([ph("o1", "2026-01-01"), ph("o2", "2026-02-01"), ph("f1", "2026-01-05", "front")]);
    expect(pairs.map((p) => p.pose)).toEqual(["front", "none"]);
    expect(pairs[1].before?.id).toBe("o1");
    expect(pairs[1].after.id).toBe("o2");
  });
  it("lista vazia → nenhum par", () => {
    expect(buildPairs([])).toEqual([]);
  });
  it("comparablePoses lista só posições com 2+ fotos", () => {
    expect(comparablePoses([ph("1", "2026-01-01", "front"), ph("2", "2026-02-01", "front"), ph("3", "2026-01-01", "side")])).toEqual(["front"]);
  });
});

describe("validações do envio pelo profissional", () => {
  it("data: obrigatória, formato, não futura, não antes de 2000", () => {
    const today = "2026-10-20";
    expect(validatePhotoDate("", today)).toMatch(/Informe/);
    expect(validatePhotoDate("20/10/2026", today)).toMatch(/inválida/);
    expect(validatePhotoDate("2026-10-21", today)).toMatch(/futuro/);
    expect(validatePhotoDate("1999-12-31", today)).toMatch(/inválida/);
    expect(validatePhotoDate("2026-10-20", today)).toBeNull();
    expect(validatePhotoDate("2025-01-15", today)).toBeNull();
  });
  it("arquivo: só JPG/PNG/WebP até 10 MB", () => {
    expect(validatePhotoFile({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(validatePhotoFile({ type: "image/webp", size: 10 * 1024 * 1024 })).toBeNull();
    expect(validatePhotoFile({ type: "application/pdf", size: 10 })).toMatch(/Formato/);
    expect(validatePhotoFile({ type: "image/png", size: 10 * 1024 * 1024 + 1 })).toMatch(/10 MB/);
  });
  it("path: {patient_id}/{uuid}.ext e recusa paciente vazio", () => {
    expect(photoStorageKey("p1", "u1", "image/png")).toBe("p1/u1.png");
    expect(photoStorageKey("p1", "u1", "image/x")).toBe("p1/u1.jpg");
    expect(() => photoStorageKey("", "u1", "image/png")).toThrow();
  });
});
