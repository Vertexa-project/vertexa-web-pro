import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, from },
}));

const { deleteUnusedPatientRegistration, getPatientDeletionEligibility } = await import("./patients");

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("deleteUnusedPatientRegistration — só a RPC canônica (WP-PATIENT-DIAG-DELETE-01)", () => {
  it("chama exatamente delete_unused_patient_registration com o id do paciente, sem .from()", async () => {
    rpc.mockResolvedValue({ data: { deleted: true, patient_id: "pat-1", profile_deleted: true }, error: null });
    await deleteUnusedPatientRegistration("pat-1");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("delete_unused_patient_registration", { p_patient_id: "pat-1" });
    expect(from).not.toHaveBeenCalled();
  });

  it("propaga o erro do servidor (hint preservada para a mensagem humana)", async () => {
    const err = { code: "55000", message: "x", hint: "PATIENT_DELETE_HAS_PLANS" };
    rpc.mockResolvedValue({ data: null, error: err });
    await expect(deleteUnusedPatientRegistration("pat-1")).rejects.toBe(err);
  });

  it("sem confirmação do servidor não considera excluído", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await expect(deleteUnusedPatientRegistration("pat-1")).rejects.toThrow();
  });
});

describe("getPatientDeletionEligibility", () => {
  it("lê a RPC de elegibilidade e devolve só eligible/reason", async () => {
    rpc.mockResolvedValue({
      data: { eligible: false, reason: "PATIENT_DELETE_AUTH_LINKED", blockers: ["PATIENT_DELETE_AUTH_LINKED"] },
      error: null,
    });
    const r = await getPatientDeletionEligibility("pat-9");
    expect(rpc).toHaveBeenCalledWith("get_patient_deletion_eligibility", { p_patient_id: "pat-9" });
    expect(r).toEqual({ eligible: false, reason: "PATIENT_DELETE_AUTH_LINKED" });
    expect(from).not.toHaveBeenCalled();
  });

  it("resposta malformada é fail-closed (eligible=false)", async () => {
    rpc.mockResolvedValue({ data: { eligible: "true" }, error: null });
    const r = await getPatientDeletionEligibility("pat-9");
    expect(r.eligible).toBe(false);
  });
});
