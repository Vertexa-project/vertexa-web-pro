import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signUp = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signUp,
    },
  },
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureException,
}));

const { signUpWithEmail } = await import("./authSignup");

beforeEach(() => {
  signUp.mockReset();
  captureException.mockReset();
  signUp.mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signUpWithEmail", () => {
  it("chama signUp com redirect de callback e metadata sem autoridade", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:5173" });

    const result = await signUpWithEmail({
      email: "ana@clinica.com",
      password: "abcdefgh",
      fullName: "Ana Costa",
    });

    expect(result).toEqual({ kind: "check_email" });
    expect(signUp).toHaveBeenCalledTimes(1);
    const payload = signUp.mock.calls[0]?.[0] as {
      email: string;
      password: string;
      options: { emailRedirectTo: string; data: Record<string, unknown> };
    };
    expect(payload.email).toBe("ana@clinica.com");
    expect(payload.password).toBe("abcdefgh");
    expect(payload.options.emailRedirectTo).toBe("http://localhost:5173/auth/callback");
    expect(payload.options.data).toEqual({ full_name: "Ana Costa", signup_surface: "web" });
    expect(Object.keys(payload.options.data).sort()).toEqual(["full_name", "signup_surface"]);
    expect(payload.options.data.role).toBeUndefined();
    expect(payload.options.data.clinic_id).toBeUndefined();
    expect(payload.options.data.is_admin).toBeUndefined();
    expect(payload.options.data.professional_id).toBeUndefined();
  });

  it("duplicata ou conta Google existente vira o mesmo estado neutro", async () => {
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered", status: 422 },
    });

    await expect(
      signUpWithEmail({ email: "ana@clinica.com", password: "abcdefgh", fullName: "Ana Costa" }),
    ).resolves.toEqual({ kind: "check_email" });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("rate limit não vira check_email e não tenta de novo", async () => {
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "email rate limit exceeded", status: 429, code: "over_email_send_rate_limit" },
    });

    await expect(
      signUpWithEmail({ email: "ana@clinica.com", password: "abcdefgh", fullName: "Ana Costa" }),
    ).resolves.toEqual({ kind: "rate_limited" });
    expect(signUp).toHaveBeenCalledTimes(1);
  });

  it("erro genérico não vaza detalhe e reporta sem senha", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "debug")];
    spies.forEach((spy) => spy.mockImplementation(() => undefined));
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Database error saving new user", status: 500 },
    });

    await expect(
      signUpWithEmail({ email: "ana@clinica.com", password: "super-secret-pw", fullName: "Ana Costa" }),
    ).resolves.toEqual({ kind: "failed" });
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[1]).toEqual({ source: "auth", scope: "signup" });
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("super-secret-pw");
    }
  });
});
