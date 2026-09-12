import { describe, expect, it, vi } from "vitest";

import { removeAvatarWithCleanup, replaceAvatarWithCleanup } from "./replaceFlow";

const NEW_PATH = `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1/${"ab".repeat(16)}.webp`;
const OLD_PATH = `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1/${"cd".repeat(16)}.webp`;

describe("replaceAvatarWithCleanup", () => {
  it("upload → RPC → só então apaga o anterior", async () => {
    const order: string[] = [];
    await replaceAvatarWithCleanup({
      upload: async () => {
        order.push("upload");
      },
      setPath: async () => {
        order.push("set");
        return OLD_PATH;
      },
      removeObject: async (path) => {
        order.push(`remove:${path === OLD_PATH ? "old" : "other"}`);
      },
      path: NEW_PATH,
      blob: new Blob([new Uint8Array([1])], { type: "image/webp" }),
      previousPath: OLD_PATH,
    });
    expect(order).toEqual(["upload", "set", "remove:old"]);
  });

  it("se o RPC falha, remove o arquivo novo e não apaga o anterior", async () => {
    const removed: string[] = [];
    await expect(
      replaceAvatarWithCleanup({
        upload: async () => {},
        setPath: async () => {
          throw new Error("rpc");
        },
        removeObject: async (path) => {
          removed.push(path);
        },
        path: NEW_PATH,
        blob: new Blob([new Uint8Array([1])], { type: "image/webp" }),
        previousPath: OLD_PATH,
      }),
    ).rejects.toThrow("rpc");
    expect(removed).toEqual([NEW_PATH]);
  });

  it("falha ao apagar o anterior não reverte a foto nova", async () => {
    await expect(
      replaceAvatarWithCleanup({
        upload: async () => {},
        setPath: async () => OLD_PATH,
        removeObject: async () => {
          throw new Error("delete old");
        },
        path: NEW_PATH,
        blob: new Blob([new Uint8Array([1])], { type: "image/webp" }),
        previousPath: OLD_PATH,
      }),
    ).resolves.toBe(NEW_PATH);
  });

  it("upload falho não chama RPC", async () => {
    const setPath = vi.fn();
    await expect(
      replaceAvatarWithCleanup({
        upload: async () => {
          throw new Error("upload");
        },
        setPath,
        removeObject: async () => {},
        path: NEW_PATH,
        blob: new Blob([new Uint8Array([1])], { type: "image/webp" }),
        previousPath: OLD_PATH,
      }),
    ).rejects.toThrow("upload");
    expect(setPath).not.toHaveBeenCalled();
  });
});

describe("removeAvatarWithCleanup", () => {
  it("RPC primeiro; delete do storage é best-effort", async () => {
    const order: string[] = [];
    await removeAvatarWithCleanup({
      clearPath: async () => {
        order.push("clear");
        return OLD_PATH;
      },
      removeObject: async () => {
        order.push("remove");
        throw new Error("storage");
      },
    });
    expect(order).toEqual(["clear", "remove"]);
  });

  it("se o RPC falha, não tenta apagar storage", async () => {
    const removeObject = vi.fn();
    await expect(
      removeAvatarWithCleanup({
        clearPath: async () => {
          throw new Error("rpc");
        },
        removeObject,
      }),
    ).rejects.toThrow("rpc");
    expect(removeObject).not.toHaveBeenCalled();
  });
});
