import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, fmtDayMonth, lineText, toForm, validateSequence } from "./reengagement";

const ok = () => toForm(DEFAULT_CONFIG);

describe("reengagement: sequência", () => {
  it("padrão: dias 5, 8 e 12, desligado, sem falar de peso", () => {
    expect(DEFAULT_CONFIG.steps.map((s) => s.day)).toEqual([5, 8, 12]);
    expect(DEFAULT_CONFIG.isActive).toBe(false);
    for (const s of DEFAULT_CONFIG.steps) expect(`${s.title} ${s.body}`.toLowerCase()).not.toMatch(/peso|kg|balança/);
  });
  it("aceita o padrão", () => {
    const r = validateSequence(ok());
    expect(r.ok).toBe(true);
  });
  it("dias precisam ser crescentes e entre 1 e 365", () => {
    const f = ok(); f[1]!.day = "5";
    expect(validateSequence(f)).toMatchObject({ ok: false });
    const g = ok(); g[2]!.day = "400";
    expect(validateSequence(g)).toMatchObject({ ok: false });
    const h = ok(); h[0]!.day = "0";
    expect(validateSequence(h)).toMatchObject({ ok: false });
    const i = ok(); i[0]!.day = "2,5";
    expect(validateSequence(i)).toMatchObject({ ok: false });
  });
  it("título e mensagem obrigatórios e com limite", () => {
    const f = ok(); f[0]!.title = "  ";
    expect(validateSequence(f)).toMatchObject({ ok: false });
    const g = ok(); g[1]!.body = "x".repeat(501);
    expect(validateSequence(g)).toMatchObject({ ok: false });
    const h = ok(); h[2]!.title = "x".repeat(81);
    expect(validateSequence(h)).toMatchObject({ ok: false });
  });
  it("aparar espaços e devolver números", () => {
    const f = ok(); f[0]!.day = " 3 "; f[0]!.title = "  Oi  ";
    const r = validateSequence(f);
    expect(r.ok && r.value[0]).toMatchObject({ day: 3, title: "Oi" });
  });
});

describe("reengagement: textos da ficha", () => {
  it("dd/mm sem virar o dia por fuso", () => {
    expect(fmtDayMonth("2026-11-24")).toBe("24/11");
    expect(fmtDayMonth(null)).toBe("—");
  });
  it("em andamento / parou / concluída", () => {
    expect(lineText({ step: 2, sent_on: "2026-11-24", state: "em_andamento" })).toBe("mensagem 2 de 3 enviada em 24/11");
    expect(lineText({ step: 2, sent_on: "2026-11-24", state: "respondeu" })).toContain("parou porque o paciente voltou a interagir");
    expect(lineText({ step: 3, sent_on: "2026-11-30", state: "concluida" })).toContain("sequência concluída");
  });
});
