import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resetPasswordForEmail = vi.hoisted(() => vi.fn());
const updateUser = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail,
      updateUser,
    },
  },
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureException,
}));

const { requestPasswordReset, updatePassword } = await import("./authPassword");

const originalOrigin = window.location.origin;

beforeEach(() => {
  resetPasswordForEmail.mockReset();
  updateUser.mockReset();
  captureException.mockReset();
  resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  updateUser.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestPasswordReset", () => {
  it("rate limit devolve kind sem enumerar conta", async () => {
    resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: "email rate limit exceeded", status: 429, code: "over_email_send_rate_limit" },
    });
    await expect(requestPasswordReset("alguem@clinica.com")).resolves.toEqual({ kind: "rate_limited" });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("R3/R4 — envia o e-mail e redirectTo termina em /auth/update-password", async () => {
    await expect(requestPasswordReset("pessoa@clinica.com")).resolves.toEqual({ kind: "sent" });

    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1);
    const [email, options] = resetPasswordForEmail.mock.calls[0] as [
      string,
      { redirectTo: string },
    ];
    expect(email).toBe("pessoa@clinica.com");
    expect(options.redirectTo.endsWith("/auth/update-password")).toBe(true);
    expect(options.redirectTo.startsWith(originalOrigin)).toBe(true);
  });

  it("usa o origin atual, sem domínio de produção hardcoded", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:5173" });
    await requestPasswordReset("qa@example.com");
    const options = resetPasswordForEmail.mock.calls[0]?.[1] as { redirectTo: string };
    expect(options.redirectTo).toBe("http://localhost:5173/auth/update-password");
    expect(options.redirectTo.includes("vertexa-web-pro.vercel.app")).toBe(false);
  });

  it("R2 — e-mail inválido não chama o client", async () => {
    await requestPasswordReset("");
    await requestPasswordReset("   ");
    await requestPasswordReset("nao-e-email");
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("erro do GoTrue é engolido (anti-enumeration) e reportado sem e-mail", async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: { message: "User not found" } });
    await expect(requestPasswordReset("alguem@clinica.com")).resolves.toEqual({ kind: "sent" });
    expect(captureException).toHaveBeenCalledTimes(1);
    const ctx = captureException.mock.calls[0]?.[1] as { source: string; scope: string };
    expect(ctx).toEqual({ source: "auth", scope: "password-reset-request" });
  });
});

describe("updatePassword", () => {
  it("R12 — chama updateUser uma vez com a senha", async () => {
    await updatePassword("secret-ok-1");
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({ password: "secret-ok-1" });
  });

  it("propaga erro genérico do client (a UI não vaza detalhe)", async () => {
    const err = { message: "Password should be at least 6 characters" };
    updateUser.mockResolvedValue({ data: {}, error: err });
    await expect(updatePassword("secret-ok-1")).rejects.toEqual(err);
  });
});
