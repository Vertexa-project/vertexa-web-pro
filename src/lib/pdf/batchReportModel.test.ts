import { describe, expect, it, vi } from "vitest";

import type { ReportExportResponse } from "@/lib/api/report";
import { buildBatchReportModel, runPatientBatch, type BatchItemResult } from "./batchReportModel";

const NOW = new Date("2026-07-20T12:00:00Z");

function resp(patientName: string, truncated = false): ReportExportResponse {
  return {
    meta: {
      patient_id: patientName,
      from: "2026-04-21",
      to: "2026-07-20",
      sections: ["identity"],
      record_count: 1,
      truncated,
      generated_at: "2026-07-20T12:00:00Z",
      exported_by: { profile_id: "prof1", name: "Dra. Camila" },
    },
    patient: { full_name: patientName, clinic: { id: "c1", name: "Clínica Vértice" } },
    sections: { identity: { full_name: patientName } },
  };
}

describe("runPatientBatch — sequencial, falha parcial NÃO aborta", () => {
  it("processa todos e reporta progresso a cada paciente", async () => {
    const progress: Array<[number, number]> = [];
    const out = await runPatientBatch(
      ["a", "b", "c"],
      async (pid) => resp(pid),
      (done, total) => progress.push([done, total]),
    );
    expect(out.includedCount).toBe(3);
    expect(out.failedIds).toEqual([]);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(out.results.map((r) => r.patientId)).toEqual(["a", "b", "c"]); // ordem preservada
  });

  it("um paciente falha (42501) ⇒ registra o insucesso e SEGUE os demais", async () => {
    const exportOne = vi.fn(async (pid: string) => {
      if (pid === "b") throw { code: "42501", message: "not authorized" };
      return resp(pid);
    });
    const out = await runPatientBatch(["a", "b", "c"], exportOne);
    expect(exportOne).toHaveBeenCalledTimes(3); // NÃO abortou em 'b'
    expect(out.includedCount).toBe(2);
    expect(out.failedIds).toEqual(["b"]);
    expect(out.results.find((r) => r.patientId === "b")?.ok).toBe(false);
  });
});

describe("buildBatchReportModel — capa (incluídos/falhados) + 1 modelo por paciente", () => {
  const results: BatchItemResult[] = [
    { patientId: "a", ok: true, value: resp("Ana") },
    { patientId: "b", ok: false, error: { code: "42501" } },
    { patientId: "c", ok: true, value: resp("Carlos", true) },
  ];

  it("inclui só os OK; lista os que falharam com nome resolvido", () => {
    const m = buildBatchReportModel(results, NOW, { b: "Bruno" });
    expect(m.total).toBe(3);
    expect(m.includedCount).toBe(2);
    expect(m.patients.map((p) => p.patientName)).toEqual(["Ana", "Carlos"]);
    expect(m.failed).toEqual([{ patientId: "b", name: "Bruno" }]);
  });

  it("cabeçalho do lote vem do 1º incluído (profissional/clínica/período)", () => {
    const m = buildBatchReportModel(results, NOW);
    expect(m.exportedByName).toBe("Dra. Camila");
    expect(m.clinicName).toBe("Clínica Vértice");
    expect(m.periodLabel).toBe("21/04/2026 – 20/07/2026");
    expect(m.generatedAt).toBe("20/07/2026");
  });

  it("truncamento é preservado POR PACIENTE (A4)", () => {
    const m = buildBatchReportModel(results, NOW);
    const ana = m.patients.find((p) => p.patientName === "Ana");
    const carlos = m.patients.find((p) => p.patientName === "Carlos");
    expect(ana?.truncated).toBe(false);
    expect(carlos?.truncated).toBe(true);
    expect(carlos?.truncationNotice).toMatch(/omitidos por limite de volume/);
  });

  it("falha sem nome resolvido cai para null (a capa mostra 'Paciente')", () => {
    const m = buildBatchReportModel(results, NOW);
    expect(m.failed[0].name).toBeNull();
  });
});
