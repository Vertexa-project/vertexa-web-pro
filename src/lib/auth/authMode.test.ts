import { describe, expect, it } from "vitest";

import { assertAuthMode } from "./authMode";

describe("assertAuthMode — fail-closed (WP-04A)", () => {
  it("ausente sobe", () => {
    expect(() => assertAuthMode(undefined)).not.toThrow();
  });

  it("vazio sobe", () => {
    expect(() => assertAuthMode("")).not.toThrow();
  });

  it('"real" sobe (inócuo na Vercel)', () => {
    expect(() => assertAuthMode("real")).not.toThrow();
  });

  it('"demo" falha — nunca habilita bypass', () => {
    expect(() => assertAuthMode("demo")).toThrow(/não é suportado/);
  });

  it("qualquer outro valor falha", () => {
    expect(() => assertAuthMode("staging")).toThrow(/não é suportado/);
  });
});
