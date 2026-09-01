import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

const {
  amIPlatformAdmin,
  listPlatformClinics,
  getPlatformClinicOnboardingSettings,
  setClinicOnboardingPolicy,
  listClinicCreationRequests,
  approveClinicCreationRequest,
  rejectClinicCreationRequest,
} = await import("./platformAdmin");

beforeEach(() => {
  rpc.mockReset();
});

describe("amIPlatformAdmin", () => {
  it("chama só a RPC pública am_i_platform_admin", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(amIPlatformAdmin()).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("am_i_platform_admin");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("false da RPC permanece false (não é erro)", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(amIPlatformAdmin()).resolves.toBe(false);
  });

  it("erro da RPC é throw — NÃO converte em false", async () => {
    const err = { message: "network", code: "57014" };
    rpc.mockResolvedValue({ data: null, error: err });
    await expect(amIPlatformAdmin()).rejects.toEqual(err);
  });
});

describe("listPlatformClinics — T11 projection da RPC", () => {
  it("mapeia a projection permitida e não pede outras tabelas", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          clinic_id: "clinic-hidden-id",
          clinic_name: "Clínica Horizonte",
          created_at: "2026-03-01T00:00:00Z",
          owner_profile_id: "owner-hidden-id",
          professional_count: "2",
          patient_count: 3,
        },
      ],
      error: null,
    });

    await expect(listPlatformClinics()).resolves.toEqual([
      {
        clinicId: "clinic-hidden-id",
        clinicName: "Clínica Horizonte",
        createdAt: "2026-03-01T00:00:00Z",
        ownerProfileId: "owner-hidden-id",
        professionalCount: 2,
        patientCount: 3,
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("list_platform_clinics");
    expect(rpc.mock.calls[0]?.length).toBe(1);
  });

  it("lista nula vira array vazio", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(listPlatformClinics()).resolves.toEqual([]);
  });

  it("erro da lista é throw (sem fallback clínico)", async () => {
    const err = { message: "NOT_PLATFORM_ADMIN", code: "42501" };
    rpc.mockResolvedValue({ data: null, error: err });
    await expect(listPlatformClinics()).rejects.toEqual(err);
  });
});

describe("platform onboarding RPCs", () => {
  it("lê settings sem argumentos extra", async () => {
    rpc.mockResolvedValue({
      data: {
        mode: "manual_review",
        updated_at: "2026-09-01T00:00:00Z",
        updated_by_profile_id: "pa-1",
        updated_by_name: "PA",
        pending_request_count: "2",
      },
      error: null,
    });
    await expect(getPlatformClinicOnboardingSettings()).resolves.toEqual({
      mode: "manual_review",
      updatedAt: "2026-09-01T00:00:00Z",
      updatedByProfileId: "pa-1",
      updatedByName: "PA",
      pendingRequestCount: 2,
    });
    expect(rpc).toHaveBeenCalledWith("get_platform_clinic_onboarding_settings");
  });

  it("salva política só com p_mode", async () => {
    rpc.mockResolvedValue({ data: { mode: "closed", pending_request_count: 0 }, error: null });
    await setClinicOnboardingPolicy("closed");
    expect(rpc).toHaveBeenCalledWith("set_clinic_onboarding_policy", { p_mode: "closed" });
  });

  it("lista solicitações e mapeia sem inventar status", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          request_id: "r1",
          requested_clinic_name: "Alfa",
          requester_profile_id: "p1",
          requester_name: "Ana",
          requester_email: "ana@t.test",
          status: "pending",
          requested_at: "2026-09-01T00:00:00Z",
          decided_at: null,
          rejection_reason: null,
        },
      ],
      error: null,
    });
    await expect(listClinicCreationRequests()).resolves.toEqual([
      {
        requestId: "r1",
        requestedClinicName: "Alfa",
        requesterProfileId: "p1",
        requesterName: "Ana",
        requesterEmail: "ana@t.test",
        status: "pending",
        requestedAt: "2026-09-01T00:00:00Z",
        decidedAt: null,
        rejectionReason: null,
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("list_clinic_creation_requests");
  });

  it("aprova e recusa sem forjar target_profile_id", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await approveClinicCreationRequest("r1");
    await rejectClinicCreationRequest("r1", "motivo");
    expect(rpc).toHaveBeenCalledWith("approve_clinic_creation_request", { p_request_id: "r1" });
    expect(rpc).toHaveBeenCalledWith("reject_clinic_creation_request", {
      p_request_id: "r1",
      p_reason: "motivo",
    });
  });

  it("erro de settings é throw — não vira closed silencioso", async () => {
    const err = { message: "NOT_PLATFORM_ADMIN", code: "42501" };
    rpc.mockResolvedValue({ data: null, error: err });
    await expect(getPlatformClinicOnboardingSettings()).rejects.toEqual(err);
  });
});
