import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("useClinicOnboardingState", () => {
  it("faz poll enquanto o pedido está pending em manual_review", () => {
    const src = readFileSync(fileURLToPath(import.meta.url).replace(/\.test\.ts$/, ".ts"), "utf8");
    expect(src).toContain("refetchInterval");
    expect(src).toContain("manual_review");
    expect(src).toContain("pending");
    expect(src).toMatch(/15_000/);
  });

  it("não vive no mesmo arquivo de pages clínicas (fronteira)", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(dir, "useClinicOnboardingState.ts"), "utf8");
    expect(src).not.toContain("from(\"patients\")");
    expect(src).toContain("getClinicOnboardingState");
  });
});
