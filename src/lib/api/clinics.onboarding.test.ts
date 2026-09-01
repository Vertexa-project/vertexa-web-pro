import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

const { getClinicOnboardingState, requestClinicCreation, createClinicWithOwner } =
  await import("./clinics");

beforeEach(() => {
  rpc.mockReset();
});

describe("clinic onboarding client", () => {
  it("get_clinic_onboarding_state é chamado com zero argumentos", async () => {
    rpc.mockResolvedValue({ data: { mode: "closed", request: null }, error: null });
    await expect(getClinicOnboardingState()).resolves.toEqual({ mode: "closed", request: null });
    expect(rpc).toHaveBeenCalledWith("get_clinic_onboarding_state");
    expect(rpc.mock.calls[0]?.length).toBe(1);
  });

  it("request_clinic_creation envia só o nome", async () => {
    rpc.mockResolvedValue({
      data: { request_id: "r1", status: "pending", requested_clinic_name: "Alfa" },
      error: null,
    });
    await requestClinicCreation("Alfa");
    expect(rpc).toHaveBeenCalledWith("request_clinic_creation", { p_name: "Alfa" });
  });

  it("create_clinic_with_owner continua só com p_name — sem channel_id", async () => {
    rpc.mockResolvedValue({
      data: { clinic_id: "c1", professional_id: "p1" },
      error: null,
    });
    await createClinicWithOwner("Alfa");
    expect(rpc).toHaveBeenCalledWith("create_clinic_with_owner", { p_name: "Alfa" });
    expect(JSON.stringify(rpc.mock.calls[0])).not.toMatch(/channel_id|patient_id/);
  });

  it("erro da policy é throw — não vira request vazio", async () => {
    const err = { message: "down", code: "57014" };
    rpc.mockResolvedValue({ data: null, error: err });
    await expect(getClinicOnboardingState()).rejects.toEqual(err);
  });
});
