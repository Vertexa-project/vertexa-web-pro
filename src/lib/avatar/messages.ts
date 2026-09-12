export type AvatarOpKind = "upload" | "save" | "remove" | "process";

export function avatarOpMessage(kind: AvatarOpKind): string {
  switch (kind) {
    case "upload":
      return "Falha no upload.";
    case "save":
      return "Falha ao salvar.";
    case "remove":
      return "Falha ao remover.";
    case "process":
      return "Não foi possível processar a imagem.";
  }
}

/** Nunca devolve path, bucket, SQL ou stack ao usuário. */
export function sanitizeAvatarError(_error: unknown, kind: AvatarOpKind): string {
  return avatarOpMessage(kind);
}
