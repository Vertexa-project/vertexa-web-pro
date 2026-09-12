import { beforeEach, describe, expect, it, vi } from "vitest";

const select = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: (query: string) => {
        select(query);
        return {
          order: () => Promise.resolve({ data: [], error: null }),
        };
      },
    }),
  },
}));

const { listPatients } = await import("./patients");

beforeEach(() => {
  select.mockClear();
});

describe("listPatients — campo de avatar", () => {
  it("o select pede avatar_path no embed de profiles, sem profiles(*)", async () => {
    await listPatients();
    expect(select).toHaveBeenCalledTimes(1);
    const query = select.mock.calls[0]?.[0] as string;
    expect(query).toMatch(/avatar_path/);
    expect(query).not.toMatch(/profiles\s*\(\s*\*/);
  });
});
