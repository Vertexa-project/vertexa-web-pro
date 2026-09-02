import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

const { getClinicOnboardingState, requestClinicCreation, createClinicWithOwner } =
  await import("./clinics");

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((name: string) => {
    if (name === "ensure_my_profile") return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: null });
  });
});

describe("clinic onboarding client", () => {
  it("get_clinic_onboarding_state é chamado com zero argumentos", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "ensure_my_profile") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: { mode: "closed", request: null }, error: null });
    });
    await expect(getClinicOnboardingState()).resolves.toEqual({ mode: "closed", request: null });
    expect(rpc).toHaveBeenCalledWith("ensure_my_profile");
    expect(rpc).toHaveBeenCalledWith("get_clinic_onboarding_state");
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

  it("mapeia grant_is_active da request aprovada", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === "ensure_my_profile") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({
        data: {
          mode: "manual_review",
          request: {
            id: "r1",
            requested_clinic_name: "Alfa",
            status: "approved",
            requested_at: "2026-09-01T00:00:00Z",
            decided_at: "2026-09-01T01:00:00Z",
            rejection_reason: null,
            grant_is_active: false,
          },
        },
        error: null,
      });
    });
    await expect(getClinicOnboardingState()).resolves.toEqual({
      mode: "manual_review",
      request: {
        id: "r1",
        requestedClinicName: "Alfa",
        status: "approved",
        requestedAt: "2026-09-01T00:00:00Z",
        decidedAt: "2026-09-01T01:00:00Z",
        rejectionReason: null,
        grantIsActive: false,
      },
    });
  });

  it("erro da policy é throw — não vira request vazio", async () => {
    const err = { message: "down", code: "57014" };
    rpc.mockImplementation((name: string) => {
      if (name === "ensure_my_profile") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: err });
    });
    await expect(getClinicOnboardingState()).rejects.toEqual(err);
  });
});
