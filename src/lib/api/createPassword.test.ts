import { beforeEach, describe, expect, it, vi } from "vitest";

const updateUser = vi.hoisted(() => vi.fn());
const getUser = vi.hoisted(() => vi.fn());
const signUp = vi.hoisted(() => vi.fn());
const captureException = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { updateUser, getUser, signUp },
  },
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureException,
}));

const { createPasswordForCurrentUser } = await import("./createPassword");

beforeEach(() => {
  updateUser.mockReset();
  getUser.mockReset();
  signUp.mockReset();
  captureException.mockReset();
  updateUser.mockResolvedValue({
    data: { user: { id: "same-user" } },
    error: null,
  });
  getUser.mockResolvedValue({ data: { user: { id: "same-user" } }, error: null });
});

describe("createPasswordForCurrentUser", () => {
  it("chama updateUser só com password e nunca signUp", async () => {
    const user = await createPasswordForCurrentUser("abcdefgh");
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({ password: "abcdefgh" });
    const payload = updateUser.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["password"]);
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("role");
    expect(payload).not.toHaveProperty("profile_id");
    expect(payload).not.toHaveProperty("clinic_id");
    expect(payload).not.toHaveProperty("patient_id");
    expect(signUp).not.toHaveBeenCalled();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(user).toEqual({ id: "same-user" });
  });

  it("propaga erro do client sem logar a senha", async () => {
    const err = { message: "weak_password", code: "weak_password" };
    updateUser.mockResolvedValue({ data: { user: null }, error: err });
    await expect(createPasswordForCurrentUser("abcdefgh")).rejects.toEqual(err);
    expect(captureException).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ password: expect.anything() }),
    );
  });
});
