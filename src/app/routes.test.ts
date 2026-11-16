import { describe, expect, it } from "vitest";
import { footerNav, mainNav } from "./routes";

describe("menu", () => {
  it("não mostra item de roadmap com cadeado nem 'Modelos'", () => {
    const all = [...mainNav, ...footerNav];
    expect(all.some((i) => i.locked)).toBe(false);
    expect(all.some((i) => /modelos/i.test(i.label))).toBe(false);
  });
});
