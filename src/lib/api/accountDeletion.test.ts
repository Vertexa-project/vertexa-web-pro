import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ removed: [] as [string, string[]][], failBucket: "", rpc: vi.fn(async () => ({ error: null })) }));
vi.mock("@/lib/supabase", () => ({ supabase: {
  storage: { from: (b: string) => ({ remove: async (p: string[]) => { m.removed.push([b, p]); return { error: b === m.failBucket ? { message: "x" } : null }; } }) },
  rpc: m.rpc,
} }));
import { removeStoredFiles } from "./accountDeletion";
beforeEach(() => { m.removed = []; m.failBucket = ""; m.rpc.mockClear(); });

describe("removeStoredFiles", () => {
  it("agrupa por bucket e confirma ao banco quando tudo saiu", async () => {
    const failed = await removeStoredFiles("r1", [{ bucket: "a", path: "1" }, { bucket: "b", path: "2" }, { bucket: "a", path: "3" }]);
    expect(failed).toBe(0);
    expect(m.removed).toEqual([["a", ["1", "3"]], ["b", ["2"]]]);
    expect(m.rpc).toHaveBeenCalledWith("account_files_removed", { p_request: "r1" });
  });
  it("se um bucket falha, conta os arquivos e NÃO confirma (fica para nova tentativa)", async () => {
    m.failBucket = "b";
    expect(await removeStoredFiles("r1", [{ bucket: "a", path: "1" }, { bucket: "b", path: "2" }, { bucket: "b", path: "3" }])).toBe(2);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
