import { beforeEach, describe, expect, it, vi } from "vitest";

const storageUpload = vi.hoisted(() => vi.fn());
const storageRemove = vi.hoisted(() => vi.fn());
const storageSign = vi.hoisted(() => vi.fn());
const storageSignMany = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    storage: {
      from: () => ({
        upload: storageUpload,
        remove: storageRemove,
        createSignedUrl: storageSign,
        createSignedUrls: storageSignMany,
      }),
    },
  },
}));

const { replaceMyAvatar, removeMyAvatar, getAvatarSignedUrl, getAvatarSignedUrls } = await import("./avatar");

const PROFILE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const OLD = `${PROFILE}/${"cd".repeat(16)}.webp`;

beforeEach(() => {
  storageUpload.mockReset();
  storageRemove.mockReset();
  storageSign.mockReset();
  storageSignMany.mockReset();
  rpc.mockReset();
  storageUpload.mockResolvedValue({ error: null });
  storageRemove.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ data: OLD, error: null });
});

describe("replaceMyAvatar", () => {
  it("não envia profile_id no RPC — só o path", async () => {
    await replaceMyAvatar({
      profileId: PROFILE,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
      previousPath: OLD,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0] as [string, { p_path: string }];
    expect(fn).toBe("set_my_avatar");
    expect(args).toEqual({ p_path: expect.stringMatching(new RegExp(`^${PROFILE}/[0-9a-f]{32}\\.webp$`)) });
    expect(JSON.stringify(args)).not.toMatch(/profile_id|patient_id|clinic_id/);
  });

  it("se o RPC falha, remove o objeto novo", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", details: "SQL" } });
    await expect(
      replaceMyAvatar({
        profileId: PROFILE,
        blob: new Blob([new Uint8Array([1])], { type: "image/webp" }),
        previousPath: OLD,
      }),
    ).rejects.toThrow(/Falha ao salvar/);
    expect(storageRemove).toHaveBeenCalled();
    const removed = storageRemove.mock.calls[0]?.[0] as string[];
    expect(removed[0]).not.toBe(OLD);
    expect(removed[0]).toMatch(new RegExp(`^${PROFILE}/`));
  });
});

describe("removeMyAvatar", () => {
  it("chama remove_my_avatar sem argumentos de identidade", async () => {
    await removeMyAvatar();
    expect(rpc).toHaveBeenCalledWith("remove_my_avatar");
  });
});

describe("getAvatarSignedUrl", () => {
  it("não devolve erro cru do storage", async () => {
    storageSign.mockResolvedValue({ data: null, error: { message: "profile-avatars/secret" } });
    await expect(getAvatarSignedUrl(`${PROFILE}/ab.webp`)).rejects.toThrow(/sign-failed/);
  });
});

describe("getAvatarSignedUrls", () => {
  const A = `${PROFILE}/${"aa".repeat(16)}.webp`;
  const B = `${PROFILE}/${"bb".repeat(16)}.webp`;

  it("3 entradas com 2 paths únicos → uma única chamada batch com 2 paths", async () => {
    storageSignMany.mockResolvedValue({
      data: [
        { path: A, signedUrl: "https://signed.example/a", error: null },
        { path: B, signedUrl: "https://signed.example/b", error: null },
      ],
      error: null,
    });
    const map = await getAvatarSignedUrls([A, B, A, null, undefined]);
    expect(storageSignMany).toHaveBeenCalledTimes(1);
    expect(storageSign).not.toHaveBeenCalled();
    const signed = storageSignMany.mock.calls[0] as [string[], number];
    expect(signed[0]).toEqual([A, B].sort());
    expect(map.get(A)).toBe("https://signed.example/a");
    expect(map.get(B)).toBe("https://signed.example/b");
    expect(map.size).toBe(2);
  });

  it("ignora paths nulos e não chama o SDK", async () => {
    const map = await getAvatarSignedUrls([null, undefined, ""]);
    expect(storageSignMany).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });

  it("falha parcial: só mapeia os que assinaram; o resto cai no fallback", async () => {
    storageSignMany.mockResolvedValue({
      data: [
        { path: A, signedUrl: "https://signed.example/a", error: null },
        { path: B, signedUrl: "", error: "denied" },
      ],
      error: null,
    });
    const map = await getAvatarSignedUrls([A, B]);
    expect(map.get(A)).toBe("https://signed.example/a");
    expect(map.has(B)).toBe(false);
  });

  it("não devolve erro cru nem persiste URL — só Map em memória", async () => {
    storageSignMany.mockResolvedValue({ data: null, error: { message: "profile-avatars/secret" } });
    await expect(getAvatarSignedUrls([A])).rejects.toThrow(/sign-failed/);
    expect(storageSignMany).toHaveBeenCalledTimes(1);
  });
});
