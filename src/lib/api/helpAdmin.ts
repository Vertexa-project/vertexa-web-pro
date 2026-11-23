import { supabase } from "@/lib/supabase";

/** Conteúdo e contato da Central de Ajuda, cuidados pela equipe da plataforma (cartão 1317 · entrega 3). */

export const HELP_MEDIA_BUCKET = "help-media";
export const HELP_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const HELP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const HELP_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
export const HELP_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function helpMediaUrl(path: string): string {
  return supabase.storage.from(HELP_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

export interface HelpSettings {
  supportWhatsapp: string;
  supportEmail: string;
  supportHours: string;
}

export interface AdminHelpCategory {
  id: string;
  title: string;
  description: string;
  position: number;
}

export interface AdminHelpArticle {
  id: string;
  slug: string;
  categoryId: string;
  title: string;
  summary: string;
  body: string;
  videoPath: string | null;
  position: number;
  isPublished: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface AdminHelpData {
  categories: AdminHelpCategory[];
  articles: AdminHelpArticle[];
}

/** Link do WhatsApp: número só com dígitos; sem DDI, assume Brasil (55). */
export function whatsappLink(digits: string): string | null {
  const d = digits.replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`;
}

/** Número para mostrar: (98) 99999-0000. */
export function formatWhatsapp(digits: string): string {
  const d = digits.replace(/\D/g, "");
  const local = d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return d;
}

function mapSettings(raw: unknown): HelpSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    supportWhatsapp: String(r.support_whatsapp ?? ""),
    supportEmail: String(r.support_email ?? ""),
    supportHours: String(r.support_hours ?? ""),
  };
}

export async function getHelpSettings(): Promise<HelpSettings> {
  const { data, error } = await supabase.rpc("help_get_settings");
  if (error) throw error;
  return mapSettings(data);
}

export async function saveHelpSettings(s: HelpSettings): Promise<void> {
  const { error } = await supabase.rpc("platform_help_save_settings", {
    p_whatsapp: s.supportWhatsapp,
    p_email: s.supportEmail,
    p_hours: s.supportHours,
  });
  if (error) throw error;
}

export function mapAdminHelp(raw: unknown): AdminHelpData {
  const r = (raw ?? {}) as { categories?: Record<string, unknown>[]; articles?: Record<string, unknown>[] };
  return {
    categories: (r.categories ?? []).map((c) => ({
      id: String(c.id),
      title: String(c.title ?? ""),
      description: String(c.description ?? ""),
      position: Number(c.position ?? 0),
    })),
    articles: (r.articles ?? []).map((a) => ({
      id: String(a.id),
      slug: String(a.slug),
      categoryId: String(a.category_id),
      title: String(a.title ?? ""),
      summary: String(a.summary ?? ""),
      body: String(a.body ?? ""),
      videoPath: (a.video_path as string | null) ?? null,
      position: Number(a.position ?? 0),
      isPublished: a.is_published === true,
      updatedAt: (a.updated_at as string | null) ?? null,
      updatedByName: (a.updated_by_name as string | null) ?? null,
    })),
  };
}

export async function getAdminHelp(): Promise<AdminHelpData> {
  const { data, error } = await supabase.rpc("platform_help_list");
  if (error) throw error;
  return mapAdminHelp(data);
}

export interface SaveArticleInput {
  id: string | null;
  categoryId: string;
  title: string;
  summary: string;
  body: string;
  videoPath: string | null;
  position: number;
  isPublished: boolean;
}

export async function saveAdminArticle(input: SaveArticleInput): Promise<{ id: string; slug: string }> {
  const { data, error } = await supabase.rpc("platform_help_save_article", {
    p_id: input.id,
    p_category_id: input.categoryId,
    p_title: input.title,
    p_summary: input.summary,
    p_body: input.body,
    p_video_path: input.videoPath ?? "",
    p_position: input.position,
    p_is_published: input.isPublished,
  });
  if (error) throw error;
  const r = (data ?? {}) as { id: string; slug: string };
  return { id: String(r.id), slug: String(r.slug) };
}

export async function saveAdminCategory(input: {
  id: string | null;
  title: string;
  description: string;
  position: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc("platform_help_save_category", {
    p_id: input.id ?? "",
    p_title: input.title,
    p_description: input.description,
    p_position: input.position,
  });
  if (error) throw error;
  return String(data);
}

export async function deleteAdminCategory(id: string): Promise<void> {
  const { error } = await supabase.rpc("platform_help_delete_category", { p_id: id });
  if (error) throw error;
}

/** Próxima posição livre no assunto (para o tutorial novo entrar no fim). */
export function nextArticlePosition(articles: Pick<AdminHelpArticle, "categoryId" | "position">[], categoryId: string): number {
  return articles.filter((a) => a.categoryId === categoryId).reduce((m, a) => Math.max(m, a.position), 0) + 1;
}

export function helpMediaError(file: Pick<File, "size" | "type">, kind: "video" | "image"): string | null {
  if (kind === "video") {
    if (!HELP_VIDEO_TYPES.includes(file.type)) return "Envie um vídeo MP4, WebM ou MOV.";
    if (file.size > HELP_VIDEO_MAX_BYTES) return "O vídeo passa de 50 MB. Exporte em tamanho menor.";
    return null;
  }
  if (!HELP_IMAGE_TYPES.includes(file.type)) return "Envie uma imagem PNG, JPG ou WEBP.";
  if (file.size > HELP_IMAGE_MAX_BYTES) return "A imagem passa de 5 MB. Envie uma menor.";
  return null;
}

const EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Envia vídeo (pasta videos/) ou imagem (pasta images/) e devolve o caminho guardado no tutorial. */
export async function uploadHelpMedia(file: File, kind: "video" | "image"): Promise<string> {
  const problem = helpMediaError(file, kind);
  if (problem) throw new Error(problem);
  const path = `${kind === "video" ? "videos" : "images"}/${crypto.randomUUID()}.${EXT[file.type]}`;
  const { error } = await supabase.storage
    .from(HELP_MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: "31536000" });
  if (error) throw error;
  return path;
}
