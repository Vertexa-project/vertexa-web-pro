import { AVATAR_ALLOWED_MIME, AVATAR_MAX_ORIGINAL_BYTES } from "./constants";

export { AVATAR_MAX_ORIGINAL_BYTES };

const ALLOWED_EXT = new Set(["jpg", "jpeg", "png", "webp"]);
const BLOCKED_EXT = new Set(["svg", "gif", "heic", "heif", "html", "htm", "exe", "js", "xml"]);

export function looksLikeAllowedImage(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return true;
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return true;
  }
  return false;
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Valida MIME, extensão e tamanho. Não substitui decode real + magic bytes. */
export function validateAvatarImageMeta(file: { name: string; type: string; size: number }): string | null {
  if (!file.size) return "Não foi possível processar a imagem.";
  const ext = extensionOf(file.name);
  if (BLOCKED_EXT.has(ext)) return "Formato não suportado. Use JPG, PNG ou WEBP.";
  if (!AVATAR_ALLOWED_MIME.includes(file.type as (typeof AVATAR_ALLOWED_MIME)[number])) {
    return "Formato não suportado. Use JPG, PNG ou WEBP.";
  }
  if (ext && !ALLOWED_EXT.has(ext)) return "Formato não suportado. Use JPG, PNG ou WEBP.";
  if (file.size > AVATAR_MAX_ORIGINAL_BYTES) return "Arquivo muito grande. O limite é 8 MB.";
  return null;
}

export async function readFileHeader(file: Blob, length = 16): Promise<Uint8Array> {
  const buf = await file.slice(0, length).arrayBuffer();
  return new Uint8Array(buf);
}

export async function validateAvatarImageFile(file: File): Promise<string | null> {
  const meta = validateAvatarImageMeta(file);
  if (meta) return meta;
  const header = await readFileHeader(file, 16);
  if (!looksLikeAllowedImage(header)) return "Formato não suportado. Use JPG, PNG ou WEBP.";
  return null;
}
