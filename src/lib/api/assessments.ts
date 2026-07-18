import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/observability/sentry";
import type { BodyAssessment, ProgressPhoto } from "@/types/db";

// Bucket PRIVADO de fotos desde WP-STORAGE P1 (public=false). Exibição = createSignedUrl.
const PROGRESS_PHOTOS_BUCKET = "progress-photos";
const PROGRESS_PHOTO_SIGNED_URL_TTL_SECONDS = 600; // 10 min — mesma janela dos documentos.

/** Foto de progresso já resolvida p/ exibição: `display_url` = signed URL, fallback legado ou null. */
export type ProgressPhotoWithUrl = ProgressPhoto & { display_url: string | null };

/** Avaliações corporais em ordem cronológica (asc) — pronto para o gráfico de evolução. */
export async function getBodyAssessments(patientId: string): Promise<BodyAssessment[]> {
  const { data, error } = await supabase
    .from("body_assessments")
    .select("*")
    .eq("patient_id", patientId)
    .order("assessed_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BodyAssessment[];
}

export async function getProgressPhotos(patientId: string): Promise<ProgressPhoto[]> {
  const { data, error } = await supabase
    .from("progress_photos")
    .select("*")
    .eq("patient_id", patientId)
    .order("taken_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProgressPhoto[];
}

/**
 * Resolve a URL de exibição de UMA foto (bucket privado desde WP-STORAGE P1):
 *  - `storage_path` presente ⇒ createSignedUrl (TTL curto, NUNCA persistida);
 *  - `storage_path` null (linha legada) ⇒ fallback p/ `photo_url` (URL pública legada);
 *  - erro ao assinar ⇒ reporta ao Sentry (source:"storage", SEM PII — só o erro/tags) e
 *    retorna null (a tela mostra placeholder; NÃO quebra).
 */
export async function resolveProgressPhotoDisplayUrl(
  photo: Pick<ProgressPhoto, "storage_path" | "photo_url">,
): Promise<string | null> {
  if (photo.storage_path) {
    try {
      const { data, error } = await supabase.storage
        .from(PROGRESS_PHOTOS_BUCKET)
        .createSignedUrl(photo.storage_path, PROGRESS_PHOTO_SIGNED_URL_TTL_SECONDS);
      if (error) throw error;
      if (data?.signedUrl) return data.signedUrl;
      throw new Error("createSignedUrl não retornou signedUrl");
    } catch (err) {
      captureException(err, { source: "storage", scope: "sign-progress-photo" });
      return null;
    }
  }
  return photo.photo_url ?? null;
}

/** Fotos de progresso com a `display_url` já resolvida (signed URL ou fallback legado). */
export async function getProgressPhotosWithUrls(patientId: string): Promise<ProgressPhotoWithUrl[]> {
  const rows = await getProgressPhotos(patientId);
  return Promise.all(
    rows.map(async (p) => ({ ...p, display_url: await resolveProgressPhotoDisplayUrl(p) })),
  );
}

/**
 * Documentos do paciente = avaliações corporais que têm um arquivo anexado
 * (laudos de DEXA/bioimpedância em PDF etc.), mais recentes primeiro. A web só LÊ.
 * ⚠️ document_url é URL crua na sprint; bucket privado + signed URL é dívida pós-MVP
 * (PENDENCIAS #12) — não embutir o arquivo, só linkar.
 */
export async function getPatientDocuments(patientId: string): Promise<BodyAssessment[]> {
  const { data, error } = await supabase
    .from("body_assessments")
    .select("*")
    .eq("patient_id", patientId)
    .not("document_url", "is", null)
    .order("assessed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as BodyAssessment[];
}
