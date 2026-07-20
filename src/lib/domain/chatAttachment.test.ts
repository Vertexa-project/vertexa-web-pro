import { describe, expect, it, vi } from "vitest";

import {
  buildChatAttachmentPath,
  chatAttachmentExt,
  chatAttachmentKind,
  CHAT_ATTACHMENT_MIME,
  hasChatAttachment,
  MAX_CHAT_ATTACHMENT_BYTES,
  sendWithOrphanCleanup,
  validateChatAttachment,
  type PreparedChatAttachment,
} from "./chatAttachment";

const CH = "c8000000-0000-0000-0000-0000000000a1";

describe("caminho {channel_id}/{uuid}.{ext}", () => {
  it("usa a extensão canônica do MIME (não do nome do arquivo)", () => {
    expect(buildChatAttachmentPath(CH, "u1", "application/pdf")).toBe(`${CH}/u1.pdf`);
    expect(buildChatAttachmentPath(CH, "u2", "image/jpeg")).toBe(`${CH}/u2.jpg`);
    expect(buildChatAttachmentPath(CH, "u3", "image/png")).toBe(`${CH}/u3.png`);
    expect(buildChatAttachmentPath(CH, "u4", "image/webp")).toBe(`${CH}/u4.webp`);
  });

  it("sempre começa pela pasta = channel_id", () => {
    const p = buildChatAttachmentPath(CH, "abc", "image/png");
    expect(p.split("/")[0]).toBe(CH);
    expect(p).toMatch(/^[0-9a-f-]{36}\/[^/]+\.(pdf|jpg|png|webp)$/);
  });

  it("chatAttachmentExt mapeia os 4 tipos e cai em 'bin' para desconhecido", () => {
    expect(chatAttachmentExt("application/pdf")).toBe("pdf");
    expect(chatAttachmentExt("image/gif")).toBe("bin");
  });
});

describe("validação de tipo e tamanho (antes do upload)", () => {
  it("aceita os 4 tipos permitidos dentro do limite", () => {
    for (const type of CHAT_ATTACHMENT_MIME) {
      expect(validateChatAttachment({ type, size: 1024 })).toBeNull();
    }
  });

  it("recusa tipo não suportado com mensagem amigável", () => {
    expect(validateChatAttachment({ type: "image/gif", size: 10 })).toMatch(/Formato não suportado/);
    expect(validateChatAttachment({ type: "text/plain", size: 10 })).toMatch(/Formato não suportado/);
  });

  it("recusa acima de 10 MB; aceita exatamente 10 MB", () => {
    expect(validateChatAttachment({ type: "application/pdf", size: MAX_CHAT_ATTACHMENT_BYTES })).toBeNull();
    expect(validateChatAttachment({ type: "application/pdf", size: MAX_CHAT_ATTACHMENT_BYTES + 1 })).toMatch(
      /10 MB/,
    );
  });

  it("o teto é 10 MB (== file_size_limit do bucket)", () => {
    expect(MAX_CHAT_ATTACHMENT_BYTES).toBe(10485760);
  });
});

describe("escolha de renderização (imagem vs documento)", () => {
  it("image/* → imagem; pdf/desconhecido/null → documento", () => {
    expect(chatAttachmentKind("image/jpeg")).toBe("image");
    expect(chatAttachmentKind("image/png")).toBe("image");
    expect(chatAttachmentKind("image/webp")).toBe("image");
    expect(chatAttachmentKind("application/pdf")).toBe("document");
    expect(chatAttachmentKind(null)).toBe("document");
    expect(chatAttachmentKind(undefined)).toBe("document");
  });

  it("hasChatAttachment detecta a presença de path", () => {
    expect(hasChatAttachment({ attachment_path: `${CH}/x.pdf` })).toBe(true);
    expect(hasChatAttachment({ attachment_path: null })).toBe(false);
    expect(hasChatAttachment({})).toBe(false);
  });
});

describe("auto-limpeza de órfão (sendWithOrphanCleanup)", () => {
  const att: PreparedChatAttachment = { path: `${CH}/u.pdf`, name: "u.pdf", mime: "application/pdf", size: 1 };

  it("insert OK com anexo ⇒ NÃO remove o objeto", async () => {
    const removeObject = vi.fn().mockResolvedValue(undefined);
    const out = await sendWithOrphanCleanup({
      upload: async () => att,
      insert: async () => "ok",
      removeObject,
    });
    expect(out).toBe("ok");
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("insert FALHA com anexo ⇒ REMOVE o objeto órfão e propaga o erro", async () => {
    const removeObject = vi.fn().mockResolvedValue(undefined);
    const boom = new Error("insert failed");
    await expect(
      sendWithOrphanCleanup({ upload: async () => att, insert: async () => { throw boom; }, removeObject }),
    ).rejects.toBe(boom);
    expect(removeObject).toHaveBeenCalledWith(att.path);
  });

  it("insert FALHA SEM anexo (só-texto) ⇒ NÃO tenta remover", async () => {
    const removeObject = vi.fn().mockResolvedValue(undefined);
    await expect(
      sendWithOrphanCleanup({ upload: async () => null, insert: async () => { throw new Error("x"); }, removeObject }),
    ).rejects.toThrow("x");
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("se a REMOÇÃO falhar, ainda propaga o erro ORIGINAL do insert (best-effort)", async () => {
    const original = new Error("insert failed");
    await expect(
      sendWithOrphanCleanup({
        upload: async () => att,
        insert: async () => { throw original; },
        removeObject: async () => { throw new Error("remove failed"); },
      }),
    ).rejects.toBe(original);
  });
});
