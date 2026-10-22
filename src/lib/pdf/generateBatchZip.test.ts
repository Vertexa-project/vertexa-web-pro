import { beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import { blobToBytes } from "./batchZip";

const m = vi.hoisted(() => ({
  exportOne: vi.fn(),
  blobFor: vi.fn(),
  saved: null as Blob | null,
  name: "",
}));
vi.mock("@/lib/api/report", () => ({
  exportPatientReport: m.exportOne,
  MAX_BATCH_PATIENTS: 3,
  DEFAULT_REPORT_SECTIONS: ["a"],
  BATCH_REPORT_SECTIONS: ["b"],
}));
vi.mock("./generatePatientReport", () => ({ generatePatientReportBlob: m.blobFor }));
vi.mock("@react-pdf/renderer", () => ({ pdf: vi.fn() }));
vi.mock("./fonts", () => ({ registerReportFonts: vi.fn() }));
vi.mock("./BatchReport", () => ({ BatchReportDoc: () => null }));

import { downloadBatchZip } from "./generateBatchReport";

const input = (ids: string[]) => ({ patientIds: ids, from: "2026-07-01", to: "2026-10-01", sections: [] as never[] });

beforeEach(() => {
  m.exportOne.mockReset(); m.blobFor.mockReset(); m.saved = null; m.name = "";
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b) => { m.saved = b; return "blob:x"; };
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { m.name = this.download; });
  m.exportOne.mockImplementation(async (a: { patientId: string }) => ({ id: a.patientId }));
  m.blobFor.mockImplementation(async (rpc: { id: string }) => ({ blob: new Blob([`%PDF-${rpc.id}`]), patientName: rpc.id === "p3" ? "Maria" : `Paciente ${rpc.id}` }));
});

describe("downloadBatchZip", () => {
  it("baixa UM ZIP com um PDF por paciente, na ordem, e nomeia por data", async () => {
    const out = await downloadBatchZip(input(["p1", "p2"]), undefined, new Date(2026, 9, 21));
    expect(out).toEqual({ includedCount: 2, failedIds: [], total: 2 });
    expect(m.name).toBe("relatorios-2026-10-21.zip");
    const files = unzipSync(await blobToBytes(m.saved!));
    expect(Object.keys(files).sort()).toEqual(["relatorio-paciente-p1.pdf", "relatorio-paciente-p2.pdf"]);
    expect(new TextDecoder().decode(files["relatorio-paciente-p2.pdf"])).toBe("%PDF-p2");
  });
  it("usa a mesma chamada auditada por paciente, com o mesmo batch_id, em sequência", async () => {
    await downloadBatchZip(input(["p1", "p2"]));
    const calls = m.exportOne.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.patientId)).toEqual(["p1", "p2"]);
    expect(calls[0].batchId).toBeTruthy();
    expect(calls[0].batchId).toBe(calls[1].batchId);
    expect(calls[0].sections).toEqual(["a"]); // seções completas do relatório individual
  });
  it("um paciente que falha não derruba o lote e aparece em failedIds", async () => {
    m.exportOne.mockImplementation(async (a: { patientId: string }) => { if (a.patientId === "p2") throw new Error("42501"); return { id: a.patientId }; });
    const out = await downloadBatchZip(input(["p1", "p2", "p3"]));
    expect(out).toEqual({ includedCount: 2, failedIds: ["p2"], total: 3 });
    expect(Object.keys(unzipSync(await blobToBytes(m.saved!))).sort()).toEqual(["relatorio-maria.pdf", "relatorio-paciente-p1.pdf"]);
  });
  it("falha ao montar o PDF de um paciente também só o exclui", async () => {
    m.blobFor.mockImplementation(async (rpc: { id: string }) => { if (rpc.id === "p1") throw new Error("pdf"); return { blob: new Blob(["x"]), patientName: rpc.id }; });
    const out = await downloadBatchZip(input(["p1", "p2"]));
    expect(out.failedIds).toEqual(["p1"]);
  });
  it("se todos falham, não baixa nada e avisa", async () => {
    m.exportOne.mockRejectedValue(new Error("x"));
    await expect(downloadBatchZip(input(["p1", "p2"]))).rejects.toThrow("Nenhum relatório");
    expect(m.saved).toBeNull();
  });
  it("lote vazio e acima do teto são recusados antes de qualquer chamada", async () => {
    await expect(downloadBatchZip(input([]))).rejects.toThrow("ao menos um");
    await expect(downloadBatchZip(input(["a", "b", "c", "d"]))).rejects.toThrow("no máximo 3");
    expect(m.exportOne).not.toHaveBeenCalled();
  });
  it("informa o progresso a cada paciente", async () => {
    const seen: string[] = [];
    await downloadBatchZip(input(["p1", "p2"]), (d, t) => seen.push(`${d}/${t}`));
    expect(seen).toEqual(["1/2", "2/2"]);
  });
});
