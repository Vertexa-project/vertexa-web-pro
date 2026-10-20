import { describe, expect, it } from "vitest";
import { assessmentToForm, emptyAssessmentForm, parseDecimal, validateAssessment } from "./anthropometry";

const TODAY = "2026-10-20";
const base = () => ({ ...emptyAssessmentForm(TODAY), day: "2026-03-10", weight: "72,5" });
const ok = (f: ReturnType<typeof base>, existing?: Record<string, unknown> | null) => {
  const r = validateAssessment(f, TODAY, existing);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const err = (f: ReturnType<typeof base>) => {
  const r = validateAssessment(f, TODAY);
  return r.ok ? null : r.error;
};

describe("anthropometry (lançamento manual)", () => {
  it("decimal com vírgula ou ponto; vazio=null; lixo=NaN", () => {
    expect(parseDecimal("72,5")).toBe(72.5);
    expect(parseDecimal(" 80 ")).toBe(80);
    expect(parseDecimal("")).toBeNull();
    expect(Number.isNaN(parseDecimal("7a"))).toBe(true);
    expect(Number.isNaN(parseDecimal("72,555"))).toBe(true);
  });
  it("avaliação antiga: data retroativa, peso e % gordura viram o payload", () => {
    const v = ok({ ...base(), bodyFat: "28,4" });
    expect(v).toEqual({ assessed_at: "2026-03-10", method: "manual", weight: 72.5, body_fat_pct: 28.4, measurements: null });
  });
  it("circunferências vazias não entram; preenchidas viram números no jsonb", () => {
    const v = ok({ ...base(), measures: { cintura: "84,5", quadril: "", braco: "31" } });
    expect(v.measurements).toEqual({ cintura: 84.5, braco: 31 });
  });
  it("só circunferência (sem peso nem gordura) é válido", () => {
    const v = ok({ ...base(), weight: "", measures: { cintura: "80" } });
    expect(v.weight).toBeNull();
    expect(v.measurements).toEqual({ cintura: 80 });
  });
  it("sem nenhum dado é recusado", () => {
    expect(err({ ...base(), weight: "" })).toMatch(/ao menos o peso/);
    expect(err({ ...base(), weight: "", notes: "só uma observação" })).toMatch(/ao menos o peso/);
  });
  it("data futura, ausente ou método inválido são recusados", () => {
    expect(err({ ...base(), day: "2026-10-21" })).toMatch(/futura/);
    expect(err({ ...base(), day: "" })).toMatch(/data/i);
    expect(err({ ...base(), method: "xyz" })).toMatch(/método/);
  });
  it("limites: peso 20–400, gordura 1–70, circunferência 10–300", () => {
    expect(err({ ...base(), weight: "19" })).toMatch(/Peso inválido/);
    expect(err({ ...base(), weight: "401" })).toMatch(/Peso inválido/);
    expect(err({ ...base(), bodyFat: "71" })).toMatch(/gordura inválido/);
    expect(err({ ...base(), bodyFat: "0,5" })).toMatch(/gordura inválido/);
    expect(err({ ...base(), measures: { cintura: "9" } })).toMatch(/Cintura inválido/);
    expect(err({ ...base(), measures: { coxa: "301" } })).toMatch(/Coxa inválido/);
  });
  it("edição preserva chaves desconhecidas e as observações antigas; limpar campo remove a chave", () => {
    const existing = { cintura: 90, notes: "antiga", extra: "x" };
    const v = ok({ ...base(), measures: { cintura: "" }, notes: "" }, existing);
    expect(v.measurements).toEqual({ extra: "x" });
    const v2 = ok({ ...base(), measures: { cintura: "88" }, notes: "nova" }, existing);
    expect(v2.measurements).toEqual({ cintura: 88, notes: "nova", extra: "x" });
  });
  it("observações têm limite", () => {
    expect(err({ ...base(), notes: "a".repeat(1001) })).toMatch(/passam de 1000/);
  });
  it("avaliação existente vira formulário (vírgula decimal, método desconhecido → manual)", () => {
    const f = assessmentToForm({ assessed_at: "2026-03-10", method: "legado", weight: 72.5, body_fat_pct: null, measurements: { cintura: 84, notes: "ok" } }, TODAY);
    expect(f).toMatchObject({ day: "2026-03-10", method: "manual", weight: "72,5", bodyFat: "", notes: "ok" });
    expect(f.measures.cintura).toBe("84");
    expect(f.measures.quadril).toBe("");
  });
});
