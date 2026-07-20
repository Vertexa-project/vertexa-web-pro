import { describe, expect, it } from "vitest";

import type { ReportExportResponse } from "@/lib/api/report";
import { buildPatientReportModel } from "./patientReportModel";

const NOW = new Date("2026-07-20T12:00:00Z");

function rpc(overrides: Partial<ReportExportResponse> = {}): ReportExportResponse {
  return {
    meta: {
      patient_id: "p1",
      from: "2026-04-21",
      to: "2026-07-20",
      sections: ["identity", "weight", "anthropometry", "adherence"],
      record_count: 8,
      truncated: false,
      generated_at: "2026-07-20T12:00:00Z",
      exported_by: { profile_id: "prof1", name: "Dra. Camila" },
      ...(overrides.meta ?? {}),
    },
    patient: { full_name: "João Silva", goal: "Emagrecer", clinic: { id: "c1", name: "Clínica Vértice" }, ...(overrides.patient ?? {}) },
    sections: overrides.sections ?? {
      weight: [
        { measured_at: "2026-05-01", weight_kg: 80, source: "app" },
        { measured_at: "2026-06-01", weight_kg: 78, source: "app" },
      ],
      anthropometry: [{ assessed_at: "2026-05-10", method: "bioimpedancia", weight: 79, body_fat_pct: 24 }],
      adherence: { score: 82, level: "alto", streak: 12, weekly_completion_rate: 90 },
    },
  };
}

describe("buildPatientReportModel — montagem do PDF a partir do JSON da RPC", () => {
  it("cabeçalho: paciente, clínica, período, profissional e objetivo", () => {
    const m = buildPatientReportModel(rpc(), NOW);
    expect(m.patientName).toBe("João Silva");
    expect(m.clinicName).toBe("Clínica Vértice");
    expect(m.periodLabel).toBe("21/04/2026 – 20/07/2026");
    expect(m.identity).toEqual([
      { label: "Profissional", value: "Dra. Camila" },
      { label: "Clínica", value: "Clínica Vértice" },
      { label: "Período", value: "21/04/2026 – 20/07/2026" },
      { label: "Objetivo", value: "Emagrecer" },
    ]);
    expect(m.recordCount).toBe(8);
  });

  it("peso vira tabela com data/peso/origem (na ordem recebida)", () => {
    const m = buildPatientReportModel(rpc(), NOW);
    const weight = m.sections.find((s) => s.key === "weight");
    expect(weight?.table?.rows).toEqual([
      { date: "01/05/2026", weight: "80 kg", source: "app" },
      { date: "01/06/2026", weight: "78 kg", source: "app" },
    ]);
  });

  it("adesão vira KPIs (score/nível/sequência/conclusão)", () => {
    const m = buildPatientReportModel(rpc(), NOW);
    const adh = m.sections.find((s) => s.key === "adherence");
    expect(adh?.kpis).toEqual([
      { label: "Score", value: "82" },
      { label: "Nível", value: "alto" },
      { label: "Sequência", value: "12 dias" },
      { label: "Conclusão semanal", value: "90%" },
    ]);
  });

  it("seção pedida porém VAZIA → emptyText (não some sem avisar)", () => {
    const m = buildPatientReportModel(rpc({ sections: { weight: [] } }), NOW);
    const weight = m.sections.find((s) => s.key === "weight");
    expect(weight?.emptyText).toMatch(/Sem registros de peso/);
    expect(weight?.table).toBeUndefined();
  });

  it("A4 — truncated=true ⇒ aviso legível com o período; false ⇒ null", () => {
    const t = buildPatientReportModel(rpc({ meta: { ...rpc().meta, truncated: true } }), NOW);
    expect(t.truncated).toBe(true);
    expect(t.truncationNotice).toMatch(/omitidos por limite de volume/);
    expect(t.truncationNotice).toContain("21/04/2026 – 20/07/2026");

    const f = buildPatientReportModel(rpc(), NOW);
    expect(f.truncated).toBe(false);
    expect(f.truncationNotice).toBeNull();
  });

  it("só inclui seções presentes no retorno (não inventa)", () => {
    const m = buildPatientReportModel(rpc({ sections: { weight: [{ measured_at: "2026-05-01", weight_kg: 80, source: "app" }] } }), NOW);
    expect(m.sections.map((s) => s.key)).toEqual(["weight"]);
  });

  it("fotos: metadado repassado (para o orquestrador assinar a URL)", () => {
    const m = buildPatientReportModel(
      rpc({ sections: { photos: [{ taken_at: "2026-06-01", storage_path: "c1/x.jpg", photo_url: null }] } }),
      NOW,
    );
    expect(m.photos).toEqual([{ takenAt: "2026-06-01", storagePath: "c1/x.jpg", photoUrl: null }]);
  });

  it("planos: workout_plan e nutrition_plan viram tabelas resumidas", () => {
    const m = buildPatientReportModel(
      rpc({
        sections: {
          workout_plan: { title: "Hipertrofia", workouts: [{ letter: "A", name: "Peito", primary_muscle_group: "chest", exercises: [{}, {}] }] },
          nutrition_plan: { title: "Cutting", meals: [{ time: "08:00", name: "Café", calories: 400 }] },
        },
      }),
      NOW,
    );
    expect(m.sections.find((s) => s.key === "workout_plan")?.table?.rows).toEqual([
      { letter: "A", name: "Peito", muscle: "chest", ex: "2" },
    ]);
    expect(m.sections.find((s) => s.key === "nutrition_plan")?.table?.rows).toEqual([
      { time: "08:00", name: "Café", cal: "400 kcal" },
    ]);
  });
});
