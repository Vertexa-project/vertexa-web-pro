// Regras PURAS de anexo do chat (WP-CHAT-ATTACH B/C) — compartilháveis e testáveis sem rede.
// Contrato IDÊNTICO ao do app do paciente e ao que a Parte A já aplicou no banco:
//  · bucket privado chat-attachments; caminho {channel_id}/{uuid}.{ext}
//  · tipos: application/pdf, image/jpeg, image/png, image/webp ; teto 10 MB (== file_size_limit do bucket)
// A barreira REAL é a RLS/servidor (Parte A); aqui é só validação de UX + montagem determinística do path.

export const CHAT_ATTACHMENT_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type ChatAttachmentMime = (typeof CHAT_ATTACHMENT_MIME)[number];

/** Teto de tamanho — coincide com file_size_limit do bucket (10 MB). */
export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Extensão canônica pelo MIME (o path usa SEMPRE o mime, nunca o nome do arquivo). */
export function chatAttachmentExt(mime: string): string {
  return EXT_BY_MIME[mime] ?? "bin";
}

/** Caminho do objeto: {channel_id}/{uuid}.{ext}. Os dois clientes DEVEM gerar este formato. */
export function buildChatAttachmentPath(channelId: string, uuid: string, mime: string): string {
  return `${channelId}/${uuid}.${chatAttachmentExt(mime)}`;
}

/** Valida tipo + tamanho ANTES do upload. Retorna mensagem amigável (PT-BR) ou null se OK. */
export function validateChatAttachment(file: { type: string; size: number }): string | null {
  if (!CHAT_ATTACHMENT_MIME.includes(file.type as ChatAttachmentMime)) {
    return "Formato não suportado. Envie PDF, JPG, PNG ou WEBP.";
  }
  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
    return "Arquivo muito grande. O limite é 10 MB.";
  }
  return null;
}

export type ChatAttachmentKind = "image" | "document";

/** Escolha de renderização: imagem (pré-visualização) vs documento (cartão). */
export function chatAttachmentKind(mime: string | null | undefined): ChatAttachmentKind {
  return mime && mime.startsWith("image/") ? "image" : "document";
}

/** Uma mensagem carrega anexo? (path presente) */
export function hasChatAttachment(m: { attachment_path?: string | null }): boolean {
  return Boolean(m.attachment_path);
}

export interface PreparedChatAttachment {
  path: string;
  name: string;
  mime: string;
  size: number;
}

/**
 * Orquestra o envio com anexo garantindo AUTO-LIMPEZA DE ÓRFÃO: se o upload der certo mas o INSERT
 * da mensagem falhar, remove imediatamente o objeto recém-enviado (a policy de DELETE da Parte A
 * existe exatamente para isso — órfão do próprio uploader). PURO (deps injetadas) para ser
 * testável sem rede. A remoção é best-effort e NUNCA mascara o erro original do insert.
 */
export async function sendWithOrphanCleanup<T>(deps: {
  upload: () => Promise<PreparedChatAttachment | null>;
  insert: (attachment: PreparedChatAttachment | null) => Promise<T>;
  removeObject: (path: string) => Promise<void>;
}): Promise<T> {
  const attachment = await deps.upload();
  try {
    return await deps.insert(attachment);
  } catch (err) {
    if (attachment) {
      try {
        await deps.removeObject(attachment.path);
      } catch {
        // best-effort: se a limpeza falhar, ainda propagamos o erro original do insert.
      }
    }
    throw err;
  }
}
