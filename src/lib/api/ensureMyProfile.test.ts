import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

const { ensureMyProfile } = await import("./ensureMyProfile");

beforeEach(() => {
  rpc.mockReset();
});

describe("ensureMyProfile", () => {
  it("chama ensure_my_profile sem argumentos", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(ensureMyProfile()).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("ensure_my_profile");
    expect(rpc.mock.calls[0]?.length).toBe(1);
  });

  it("erro da RPC é throw", async () => {
    const err = { message: "down", code: "57014" };
    rpc.mockResolvedValue({ data: null, error: err });
    await expect(ensureMyProfile()).rejects.toEqual(err);
  });
});
