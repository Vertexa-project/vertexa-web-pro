import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

const {
  getMyClinicCommercialAccess,
  grantPlatformCommercialAccessExemption,
  listPlatformCommercialAccess,
  mapClinicCommercialAccess,
  setPlatformCommercialAccessMode,
} = await import("./commercialAccess");

beforeEach(() => {
  rpc.mockReset();
});

describe("commercialAccess API", () => {
  it("maps server facts without accepting a browser mode", async () => {
    rpc.mockResolvedValue({
      data: {
        clinic_id: "c1",
        access_class: "PRE_CONTRACT",
        reason: "OBSERVE_ONLY",
        product_allowed: true,
        rollout_mode: "OBSERVE",
      },
      error: null,
    });
    await expect(getMyClinicCommercialAccess("c1")).resolves.toEqual({
      clinicId: "c1",
      accessClass: "PRE_CONTRACT",
      reason: "OBSERVE_ONLY",
      productAllowed: true,
      rolloutMode: "OBSERVE",
    });
    expect(rpc).toHaveBeenCalledWith("get_my_clinic_commercial_access", { p_clinic_id: "c1" });
  });

  it("lists platform governance including PRE_CONTRACT clinics", async () => {
    rpc.mockResolvedValue({
      data: {
        rollout_mode: "OBSERVE",
        provider_write_mode: "LOCKED",
        clinics: [
          {
            clinic_id: "c1",
            clinic_name: "Alfa",
            access_class: "PRE_CONTRACT",
            reason: "OBSERVE_ONLY",
            product_allowed: true,
            has_active_contract: false,
            has_active_exemption: false,
            has_sandbox_account: true,
            has_production_account: false,
          },
        ],
        exemptions: [],
        canary_clinics: [],
      },
      error: null,
    });
    const overview = await listPlatformCommercialAccess();
    expect(overview.rolloutMode).toBe("OBSERVE");
    expect(overview.providerWriteMode).toBe("LOCKED");
    expect(overview.clinics[0]?.accessClass).toBe("PRE_CONTRACT");
    expect(overview.entitlementEnforcement).toBe("OFF");
  });

  it("sends PA-only mutations without a client access class", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await setPlatformCommercialAccessMode("observe");
    await grantPlatformCommercialAccessExemption({
      clinicId: "c1",
      reason: "internal demo clinic",
    });
    expect(rpc).toHaveBeenCalledWith("set_platform_commercial_access_mode", { p_mode: "observe" });
    expect(rpc).toHaveBeenCalledWith("grant_platform_commercial_access_exemption", {
      p_clinic_id: "c1",
      p_reason: "internal demo clinic",
      p_expires_at: null,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/FULL|PRE_CONTRACT|is_paid/);
  });

  it("never treats payment received as an access class", () => {
    expect(mapClinicCommercialAccess({ product_allowed: true }, "c1").reason).not.toMatch(
      /RECEIVED|entitlement/i,
    );
  });

  it("rejects a malformed commercial access payload instead of mapping FULL", async () => {
    rpc.mockResolvedValue({ data: { unexpected: true }, error: null });
    await expect(getMyClinicCommercialAccess("c1")).rejects.toMatchObject({
      hint: "COMMERCIAL_ACCESS_MALFORMED",
    });
  });
});
