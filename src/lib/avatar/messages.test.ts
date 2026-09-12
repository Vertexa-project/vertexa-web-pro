import { describe, expect, it } from "vitest";

import { avatarOpMessage, sanitizeAvatarError } from "./messages";

describe("avatarOpMessage", () => {
  it("mensagens amigáveis, sem jargão de infra", () => {
    expect(avatarOpMessage("upload")).toMatch(/Falha no upload/);
    expect(avatarOpMessage("save")).toMatch(/Falha ao salvar/);
    expect(avatarOpMessage("remove")).toMatch(/Falha ao remover/);
    expect(avatarOpMessage("process")).toMatch(/Não foi possível processar/);
  });
});

describe("sanitizeAvatarError", () => {
  it("não vaza path, bucket, SQL nem stack", () => {
    const raw = {
      message: "violates row-level security on storage.objects bucket profile-avatars path aaa/bbb.webp",
      details: "SELECT * FROM storage.objects",
      stack: "Error: boom\n    at Object.upload",
    };
    const msg = sanitizeAvatarError(raw, "upload");
    expect(msg).toBe(avatarOpMessage("upload"));
    expect(msg).not.toMatch(/profile-avatars|storage\.objects|SELECT|aaa\/bbb/);
  });
});
