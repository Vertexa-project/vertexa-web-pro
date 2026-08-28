import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

const { amIPlatformAdmin, listPlatformClinics } = await import("./platformAdmin");

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
