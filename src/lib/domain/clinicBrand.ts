// Regras PURAS da identidade da clínica (logo + cor). Espelham as constraints do banco
// (clinics_logo_path_own_folder, clinics_brand_color_hex) e o bucket público 'clinic-logos'.
export const CLINIC_LOGOS_BUCKET = "clinic-logos";
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_ACCEPTED_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
export const LOGO_MAX_SIDE_PX = 512;

export interface ClinicBrand {
  clinicId: string;
  name: string;
  logoPath: string | null;
  color: string | null;
}

/** Mensagem de erro (pt-BR) ou null se o arquivo serve. */
export function validateLogoFile(file: { type: string; size: number }): string | null {
  if (!(LOGO_ACCEPTED_MIME as readonly string[]).includes(file.type)) return "Use uma imagem PNG, JPG ou WebP.";
  if (file.size <= 0) return "O arquivo está vazio.";
  if (file.size > LOGO_MAX_BYTES) return "A logo deve ter no máximo 2 MB.";
  return null;
}

/** "#1a2b3c" / "1A2B3C" → "#1A2B3C"; inválido → null (vazio também). */
export function normalizeHexColor(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(t);
  return m ? `#${m[1].toUpperCase()}` : null;
}

/** Caminho no bucket: {clinic_id}/{16 hex}.png — sempre PNG (a logo é normalizada antes do envio). */
export function buildLogoPath(clinicId: string, versionHex: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clinicId)) throw new Error("invalid clinic");
  if (!/^[0-9a-f]{16,64}$/.test(versionHex)) throw new Error("invalid version");
  return `${clinicId.toLowerCase()}/${versionHex}.png`;
}

/** URL pública da logo (bucket público). Sem caminho → null. */
export function logoPublicUrl(supabaseUrl: string, path: string | null | undefined): string | null {
  if (!path) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${CLINIC_LOGOS_BUCKET}/${path}`;
}

/** Iniciais para o fallback quando a clínica não tem logo ("Clínica Teste Hefesto" → "CT"). */
export function brandInitials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter((w) => w.length > 0 && /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return "?";
  const pick = words.length === 1 ? [words[0]] : [words[0], words[1]];
  return pick.map((w) => Array.from(w)[0].toUpperCase()).join("");
}

/** Dimensões finais mantendo a proporção, com o maior lado limitado a `max` (nunca amplia). */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
