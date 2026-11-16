import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ supabase: { rpc, from } }));

const api = await import("./patientImportExport");

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("patientImportExport (só RPC; nada de insert direto)", () => {
  it("importa pela RPC import_patients com clínica, arquivo e linhas", async () => {
    rpc.mockResolvedValue({ data: { imported: 1, duplicates: 0, errors: 0, results: [], batch_id: "b" }, error: null });
    const rows = [{ line: 2, name: "Ana", email: null, phone: null, birth_date: null, sex: null, goal: null, height_cm: null, weight_kg: null, force: false }];
    await api.importPatients("c1", "a.csv", rows);
    expect(rpc).toHaveBeenCalledWith("import_patients", { p_clinic: "c1", p_filename: "a.csv", p_rows: rows });
    expect(from).not.toHaveBeenCalled();
  });
  it("exporta pela RPC export_patients (auditoria e linhas vêm juntas) e apara o motivo", async () => {
    rpc.mockResolvedValue({ data: { export_id: "e", row_count: 0, rows: [] }, error: null });
    await api.exportPatients("c1", ["cadastro"], "backup", "  Backup mensal ");
    expect(rpc).toHaveBeenCalledWith("export_patients", { p_clinic: "c1", p_fields: ["cadastro"], p_reason_kind: "backup", p_reason: "Backup mensal" });
    expect(from).not.toHaveBeenCalled();
  });
  it("propaga o erro da RPC", async () => {
    rpc.mockResolvedValue({ data: null, error: { hint: "PATIENT_EXPORT_MANAGER_REQUIRED", message: "forbidden" } });
    await expect(api.exportPatients("c1", ["cadastro"], "backup", "Backup mensal")).rejects.toMatchObject({ hint: "PATIENT_EXPORT_MANAGER_REQUIRED" });
  });
  it("mensagens em português por dica do servidor, com texto genérico para o resto", () => {
    expect(api.importExportErrorMessage({ hint: "PATIENT_IMPORT_ADMIN_REQUIRED" }, "x")).toBe("Só o administrador da clínica importa pacientes.");
    expect(api.importExportErrorMessage({ hint: "PATIENT_EXPORT_MANAGER_REQUIRED" }, "x")).toMatch(/Gestor/);
    expect(api.importExportErrorMessage({ hint: "PATIENT_IMPORT_TOO_MANY" }, "x")).toMatch(/500/);
    expect(api.importExportErrorMessage(new Error("boom"), "Falhou, tente de novo")).toBe("Falhou, tente de novo");
    expect(api.importExportErrorMessage(null, "fallback")).toBe("fallback");
  });
  it("lista de exportações lê a tabela de auditoria da clínica, mais nova primeiro", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    from.mockReturnValue({ select });
    await api.listPatientExports("c1");
    expect(from).toHaveBeenCalledWith("patient_exports");
    expect(eq).toHaveBeenCalledWith("clinic_id", "c1");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
  });
});
