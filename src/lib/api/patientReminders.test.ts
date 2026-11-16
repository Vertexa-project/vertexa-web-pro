import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));

import { upsertPatientReminder } from "./patientReminders";

beforeEach(() => h.rpc.mockReset().mockResolvedValue({ data: "r1", error: null }));

describe("lembretes: contrato com o banco", () => {
  it("retorno não leva nome de exame; mensagem vazia vira null (usa o padrão)", async () => {
    await upsertPatientReminder({ patientId: "p1", kind: "return", title: "lixo", dueOn: "2026-12-10", noticeDays: 7, proNoticeDays: 3, message: "  ", notifyPatient: true });
    expect(h.rpc).toHaveBeenCalledWith("upsert_patient_reminder", { p_patient_id: "p1", p_kind: "return", p_title: null, p_due_on: "2026-12-10", p_notify_days: 7, p_pro_notify_days: 3, p_message: null, p_notify_patient: true, p_id: null });
  });
  it("editar manda o id (a mesma linha) e o texto da clínica", async () => {
    await upsertPatientReminder({ patientId: "p1", id: "r9", kind: "exam", title: "Ferritina", dueOn: "2026-12-20", noticeDays: 14, proNoticeDays: 7, message: "Oi {nome}", notifyPatient: false });
    expect(h.rpc).toHaveBeenCalledWith("upsert_patient_reminder", expect.objectContaining({ p_id: "r9", p_title: "Ferritina", p_message: "Oi {nome}", p_notify_patient: false }));
  });
});
