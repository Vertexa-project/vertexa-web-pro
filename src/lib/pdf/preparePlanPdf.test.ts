import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ workout: vi.fn(), nutrition: vi.fn(), warm: vi.fn() }));
vi.mock("@/components/patient/docimport/pdfRenderer", () => ({ preloadPdfRenderer: vi.fn().mockResolvedValue({}) }));

const load = (() => Promise.resolve({ buildWorkoutPdf: h.workout, buildNutritionPdf: h.nutrition, warmPlanPdfContext: h.warm })) as never;

import { clearPlanPdfCache, planPdfKey, preparePlanPdf } from "./preparePlanPdf";

const who = { patientName: "Ana", professionalName: "Dr. Edu" };
const plan = { id: "pl", title: "Plano", workouts: [] } as never;

beforeEach(() => {
  clearPlanPdfCache();
  h.workout.mockReset().mockResolvedValue(new Blob(["pdf"]));
  h.nutrition.mockReset().mockResolvedValue(new Blob(["pdf"]));
  h.warm.mockReset().mockResolvedValue(undefined);
});

describe("PDF do plano gerado uma vez só", () => {
  it("prévia (ao passar o mouse) e envio (ao abrir) reaproveitam o mesmo arquivo: 1 geração", async () => {
    const a = preparePlanPdf("treino", plan, who, load);
    const b = preparePlanPdf("treino", plan, who, load);
    expect(await a).toBe(await b);
    expect(h.workout).toHaveBeenCalledTimes(1);
    expect(h.warm).toHaveBeenCalled(); // marca, logo, fontes e pdf.js aquecem em paralelo
  });
  it("plano editado (ou outro paciente) gera outro PDF", async () => {
    await preparePlanPdf("treino", plan, who, load);
    await preparePlanPdf("treino", { ...(plan as object), title: "Novo" } as never, who, load);
    await preparePlanPdf("treino", plan, { ...who, patientName: "Bia" }, load);
    expect(h.workout).toHaveBeenCalledTimes(3);
    expect(planPdfKey("treino", plan, who)).not.toBe(planPdfKey("plano_alimentar", plan, who));
  });
  it("falha não fica em cache: a próxima tentativa refaz", async () => {
    h.nutrition.mockRejectedValueOnce(new Error("boom"));
    await expect(preparePlanPdf("plano_alimentar", plan, who, load)).rejects.toThrow("boom");
    await Promise.resolve();
    await expect(preparePlanPdf("plano_alimentar", plan, who, load)).resolves.toBeInstanceOf(Blob);
    expect(h.nutrition).toHaveBeenCalledTimes(2);
  });
});
