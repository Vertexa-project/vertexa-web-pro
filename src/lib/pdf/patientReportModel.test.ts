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
    // "evolution" é derivada do peso recebido (não inventa dado); nenhuma outra seção aparece.
    expect(m.sections.map((s) => s.key)).toEqual(["evolution", "weight"]);
  });

  it("fotos: metadado repassado (para o orquestrador assinar a URL)", () => {
    const m = buildPatientReportModel(
      rpc({ sections: { photos: [{ taken_at: "2026-06-01", storage_path: "c1/x.jpg", photo_url: null }] } }),
      NOW,
    );
    expect(m.photos).toEqual([{ pose: null, takenAt: "2026-06-01", storagePath: "c1/x.jpg", photoUrl: null }]);
  });

  it("fotos: a posição vinda da RPC é repassada (null quando não classificada)", () => {
    const m = buildPatientReportModel(
      rpc({ sections: { photos: [{ taken_at: "2026-06-01", storage_path: "c1/a.jpg", photo_url: null, pose: "front" }, { taken_at: "2026-06-02", storage_path: "c1/b.jpg", photo_url: null }] } }),
      NOW,
    );
    expect(m.photos.map((p) => p.pose)).toEqual(["front", null]);
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

describe("buildPatientReportModel — treino, água, suplementação e evolução no período (WP-REPORT C)", () => {
  // Período de 21 dias: 2026-06-01 .. 2026-06-21.
  const meta = { from: "2026-06-01", to: "2026-06-21" };
  const withSections = (sections: Record<string, unknown>) =>
    buildPatientReportModel(rpc({ meta: { ...rpc().meta, ...meta }, sections }), NOW);

  it("evolução: peso e % de gordura atuais, com a variação desde o início do período", () => {
    const m = withSections({
      weight: [
        { measured_at: "2026-06-01", weight_kg: 80, source: "app" },
        { measured_at: "2026-06-10", weight_kg: 77.5, source: "app" },
        { measured_at: "2026-06-20", weight_kg: 76, source: "app" },
      ],
      anthropometry: [
        { assessed_at: "2026-06-02", method: "bioimpedancia", weight: 80, body_fat_pct: 30 },
        { assessed_at: "2026-06-19", method: "bioimpedancia", weight: 76, body_fat_pct: 27.5 },
      ],
    });
    const ev = m.sections.find((s) => s.key === "evolution");
    expect(ev?.title).toBe("Evolução no período");
    expect(ev?.kpis).toEqual([
      { label: "Peso", value: "76 kg", sub: "−4 kg desde 80 kg" },
      { label: "% Gordura", value: "27.5%", sub: "−2.5 p.p. desde 30%" },
      { label: "Medições", value: "3 pesagens", sub: "2 avaliações" },
    ]);
    // a evolução abre o relatório, antes das tabelas de dados
    expect(m.sections[0].key).toBe("evolution");
  });

  it("evolução: com um único peso não inventa variação", () => {
    const m = withSections({ weight: [{ measured_at: "2026-06-05", weight_kg: 79, source: "app" }] });
    const ev = m.sections.find((s) => s.key === "evolution");
    expect(ev?.kpis?.[0]).toEqual({ label: "Peso", value: "79 kg", sub: "1 registro" });
  });

  it("evolução: sem peso nem avaliação → seção não aparece", () => {
    const m = withSections({ weight: [], anthropometry: [] });
    expect(m.sections.find((s) => s.key === "evolution")).toBeUndefined();
  });

  it("treino: resumo (sessões, duração média, frequência/semana) + últimas sessões, mais recente primeiro", () => {
    const m = withSections({
      workout_execution: [
        { performed_on: "2026-06-02", workout_name: "Treino A", total_duration_min: 50 },
        { performed_on: "2026-06-09", workout_name: "Treino B", total_duration_min: 70 },
        { performed_on: "2026-06-16", workout_name: "Treino C", total_duration_min: null },
      ],
    });
    const w = m.sections.find((s) => s.key === "workout_execution");
    expect(w?.kpis).toEqual([
      { label: "Treinos concluídos", value: "3" },
      { label: "Duração média", value: "60 min" },
      { label: "Frequência", value: "1/semana", sub: "em 21 dias" },
    ]);
    expect(w?.table?.rows.map((r) => r.date)).toEqual(["16/06/2026", "09/06/2026", "02/06/2026"]);
  });

  it("treino: lista de sessões limitada às 8 mais recentes (cabe na página)", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      performed_on: `2026-06-${String(i + 1).padStart(2, "0")}`,
      workout_name: "Treino A",
      total_duration_min: 45,
    }));
    const w = withSections({ workout_execution: many }).sections.find((s) => s.key === "workout_execution");
    expect(w?.table?.rows).toHaveLength(8);
    expect(w?.kpis?.[0]).toEqual({ label: "Treinos concluídos", value: "12" });
    expect(w?.table?.rows[0].date).toBe("12/06/2026");
  });

  it("treino: sem sessões → emptyText", () => {
    const w = withSections({ workout_execution: [] }).sections.find((s) => s.key === "workout_execution");
    expect(w?.emptyText).toMatch(/Sem execuções/);
  });

  it("água: média por dia registrado, dias com registro, melhor dia e semanas", () => {
    const m = withSections({
      hydration: [
        { day: "2026-06-01", liters: 2, entries: 2 }, // seg
        { day: "2026-06-02", liters: 3, entries: 1 },
        { day: "2026-06-09", liters: 1, entries: 1 }, // seg da semana seguinte
      ],
    });
    const h = m.sections.find((s) => s.key === "hydration");
    expect(h?.title).toBe("Hidratação");
    expect(h?.kpis).toEqual([
      { label: "Média por dia registrado", value: "2 L" },
      { label: "Dias com registro", value: "3 de 21" },
      { label: "Melhor dia", value: "3 L", sub: "02/06/2026" },
    ]);
    expect(h?.table?.rows).toEqual([
      { week: "01/06", avg: "2.5 L", days: "2" },
      { week: "08/06", avg: "1 L", days: "1" },
    ]);
  });

  it("água: ignora litros não numéricos e semanas além das 8 mais recentes", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      day: new Date(Date.UTC(2026, 3, 6 + i * 7)).toISOString().slice(0, 10), // segundas consecutivas
      liters: 2,
      entries: 1,
    }));
    const m = buildPatientReportModel(
      rpc({ meta: { ...rpc().meta, from: "2026-04-06", to: "2026-06-21" }, sections: { hydration: [...rows, { day: "2026-06-21", liters: "x", entries: 1 }] } }),
      NOW,
    );
    const h = m.sections.find((s) => s.key === "hydration");
    expect(h?.table?.rows).toHaveLength(8);
    expect(h?.kpis?.[0].value).toBe("2 L");
  });

  it("água: sem registros → emptyText", () => {
    const h = withSections({ hydration: [] }).sections.find((s) => s.key === "hydration");
    expect(h?.emptyText).toMatch(/Sem registros de água/);
  });

  it("suplementação: doses marcadas × possíveis (suplementos × dias do período) e dias", () => {
    const m = withSections({
      supplement_intakes: [
        { day: "2026-06-01", taken: 3, total: 3 },
        { day: "2026-06-02", taken: 2, total: 3 },
        { day: "2026-06-09", taken: 1, total: 3 },
      ],
    });
    const s = m.sections.find((x) => x.key === "supplement_intakes");
    expect(s?.title).toBe("Suplementação");
    // possíveis = 3 suplementos × 21 dias = 63; marcadas = 6 → 10%
    expect(s?.kpis).toEqual([
      { label: "Doses marcadas", value: "6", sub: "de 63 possíveis" },
      { label: "Adesão", value: "10%" },
      { label: "Dias com marcação", value: "3 de 21" },
    ]);
    expect(s?.table?.rows).toEqual([
      { week: "01/06", taken: "5", days: "2" },
      { week: "08/06", taken: "1", days: "1" },
    ]);
  });

  it("suplementação: sem marcações → emptyText", () => {
    const s = withSections({ supplement_intakes: [] }).sections.find((x) => x.key === "supplement_intakes");
    expect(s?.emptyText).toMatch(/Sem marcações de suplementos/);
  });

  it("ordem: evolução → treino → hidratação → suplementos/adesão (leitura do período)", () => {
    const m = withSections({
      recovery: [],
      supplement_intakes: [],
      hydration: [],
      workout_execution: [],
      weight: [{ measured_at: "2026-06-01", weight_kg: 80, source: "app" }],
    });
    expect(m.sections.map((s) => s.key)).toEqual([
      "evolution",
      "weight",
      "workout_execution",
      "hydration",
      "supplement_intakes",
      "recovery",
    ]);
  });
});
