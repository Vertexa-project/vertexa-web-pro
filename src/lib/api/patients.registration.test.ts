import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, from },
}));

const { updatePatientRegistration, getPatientRegistrationAccess } = await import("./patients");

const base = {
  patientId: "pat-1",
  fullName: "  Maria  ",
  email: "  maria@x.com ",
  birthDate: "1990-01-02",
  sex: "feminino",
  heightCm: 168,
  goal: " emagrecer ",
  startWeight: 72,
  targetWeight: 66,
  startDate: "2026-01-10",
};

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("updatePatientRegistration — só a RPC canônica", () => {
  it("envia exatamente os campos editáveis (sem clinic/auth/profile/billing)", async () => {
    rpc.mockResolvedValue({
      data: { patient_id: "pat-1", changed_fields: ["email"], login_email_locked: false },
      error: null,
    });
    const res = await updatePatientRegistration(base);
    expect(rpc).toHaveBeenCalledWith("update_patient_registration", {
      p_patient_id: "pat-1",
      p_full_name: "Maria",
      p_email: "maria@x.com",
      p_birth_date: "1990-01-02",
      p_sex: "feminino",
      p_height_cm: 168,
      p_goal: "emagrecer",
      p_start_weight: 72,
      p_target_weight: 66,
      p_start_date: "2026-01-10",
    });
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    for (const forbidden of [
      "p_clinic_id",
      "p_auth_user_id",
      "p_profile_id",
      "p_role",
      "p_status",
      "p_current_weight",
    ]) {
      expect(args).not.toHaveProperty(forbidden);
    }
    expect(res).toEqual({ patientId: "pat-1", changedFields: ["email"], loginEmailLocked: false });
  });

  it("nunca escreve por .from() (nem profiles, nem patients)", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await updatePatientRegistration(base);
    expect(from).not.toHaveBeenCalled();
  });

  it("vazios viram null (start_date nulo = manter no servidor)", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await updatePatientRegistration({
      ...base,
      email: null,
      birthDate: null,
      sex: null,
      heightCm: null,
      goal: "  ",
      startWeight: null,
      targetWeight: null,
      startDate: null,
    });
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_email: null,
      p_birth_date: null,
      p_sex: null,
      p_height_cm: null,
      p_goal: null,
      p_start_weight: null,
      p_target_weight: null,
      p_start_date: null,
    });
  });

  it("nome vazio nem chama a RPC", async () => {
    await expect(updatePatientRegistration({ ...base, fullName: "   " })).rejects.toThrow(/obrigat/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("repassa o erro cru da RPC (a UI traduz pela hint)", async () => {
    const err = { code: "23505", hint: "PATIENT_EMAIL_IN_USE", message: "email already in use" };
    rpc.mockResolvedValue({ data: null, error: err });
    await expect(updatePatientRegistration(base)).rejects.toEqual(err);
  });
});

describe("getPatientRegistrationAccess", () => {
  it("mapeia o jsonb (sem conta)", async () => {
    rpc.mockResolvedValue({
      data: { has_login_account: false, login_email_matches_registration: null },
      error: null,
    });
    await expect(getPatientRegistrationAccess("pat-1")).resolves.toEqual({
      hasLoginAccount: false,
      loginEmailMatchesRegistration: null,
    });
    expect(rpc).toHaveBeenCalledWith("get_patient_registration_access", { p_patient_id: "pat-1" });
  });

  it("mapeia o jsonb (com conta e drift)", async () => {
    rpc.mockResolvedValue({
      data: { has_login_account: true, login_email_matches_registration: false },
      error: null,
    });
    await expect(getPatientRegistrationAccess("pat-1")).resolves.toEqual({
      hasLoginAccount: true,
      loginEmailMatchesRegistration: false,
    });
  });

  it("repassa erro", async () => {
    const err = { code: "42501", hint: "PATIENT_EDIT_ADMIN_REQUIRED" };
    rpc.mockResolvedValue({ data: null, error: err });
    await expect(getPatientRegistrationAccess("pat-1")).rejects.toEqual(err);
  });
});
