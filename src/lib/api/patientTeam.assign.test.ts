import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, from },
}));

const { assignPatientProfessional } = await import("./patientTeam");

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("assignPatientProfessional — só a RPC, só os dois IDs", () => {
  it("chama assign_patient_professional com patient e professional", async () => {
    rpc.mockResolvedValue({ data: "link-1", error: null });
    await expect(
      assignPatientProfessional({ patientId: "pat-a", professionalId: "pro-2" }),
    ).resolves.toBe("link-1");
    expect(rpc).toHaveBeenCalledWith("assign_patient_professional", {
      p_patient_id: "pat-a",
      p_professional_id: "pro-2",
    });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("clinic_id");
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_clinic_id");
    expect(from).not.toHaveBeenCalled();
  });

  it("não escreve professional_patient_links pelo client", async () => {
    rpc.mockResolvedValue({ data: "link-1", error: null });
    await assignPatientProfessional({ patientId: "pat-a", professionalId: "pro-2" });
    expect(from).not.toHaveBeenCalledWith("professional_patient_links");
  });

  it("repassa erro da RPC", async () => {
    const err = { code: "42501", message: "denied" };
    rpc.mockResolvedValue({ data: null, error: err });
    await expect(
      assignPatientProfessional({ patientId: "pat-a", professionalId: "pro-2" }),
    ).rejects.toEqual(err);
  });
});
