// Arquivo da importação: tipos aceitos, limite e conversão de HEIC (só quando o navegador sabe abrir). Sem rede.
export const IMPORT_MAX_BYTES = 15 * 1024 * 1024;
export const IMPORT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";
const OK_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export const isHeic = (f: Pick<File, "type" | "name">) => /^image\/hei[cf]$/i.test(f.type) || /\.hei[cf]$/i.test(f.name);

export const MSG_HEIC = "Seu navegador não consegue abrir fotos HEIC. Envie em JPG ou PNG.";

/** Erro em PT-BR ou null. HEIC passa aqui e é convertido depois. */
export function validateImportFile(f: Pick<File, "type" | "name" | "size">): string | null {
  if (f.size <= 0) return "O arquivo está vazio.";
  if (f.size > IMPORT_MAX_BYTES) return "Arquivo muito grande. O limite é 15 MB.";
  if (isHeic(f)) return null;
  if (!OK_MIME.has(f.type)) return "Formato não suportado. Envie PDF, JPG, PNG ou HEIC.";
  return null;
}

/** HEIC → JPEG no navegador (Safari/iOS sabe; os outros costumam não saber). Falhou = mensagem pedindo JPG. */
export async function heicToJpeg(file: File): Promise<File> {
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") throw new Error("sem suporte");
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sem canvas");
    ctx.drawImage(bmp, 0, 0);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!blob || blob.size === 0) throw new Error("sem conversão");
    return new File([blob], file.name.replace(/\.hei[cf]$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    throw new Error(MSG_HEIC);
  }
}

/** Valida e devolve o arquivo pronto para subir (HEIC já convertido). */
export async function prepareImportFile(file: File): Promise<File> {
  const err = validateImportFile(file);
  if (err) throw new Error(err);
  const out = isHeic(file) ? await heicToJpeg(file) : file;
  if (out.size > IMPORT_MAX_BYTES) throw new Error("Arquivo muito grande. O limite é 15 MB.");
  return out;
}
