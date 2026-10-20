import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/observability/sentry";
import type { BodyAssessment, ProgressPhoto } from "@/types/db";
import { photoStorageKey, validatePhotoFile, type PhotoPose } from "@/lib/domain/photoPose";

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


/** Erro com mensagem amigável (sem PII) para o envio/classificação de fotos. */
export class ProgressPhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgressPhotoError";
  }
}

const PHOTO_HINT_MESSAGES: Record<string, string> = {
  PHOTO_NOT_AUTHORIZED: "Você não tem permissão para enviar fotos deste paciente.",
  CLINIC_NOT_OPERATIONAL: "A clínica está sem acesso ativo no momento.",
  PHOTO_INVALID_DATE: "Data inválida. A foto não pode ter data futura.",
  PHOTO_INVALID_POSE: "Posição inválida.",
  PHOTO_INVALID_PATH: "Arquivo inválido. Tente de novo.",
  PHOTO_FILE_MISSING: "O arquivo não chegou ao servidor. Tente de novo.",
  PHOTO_ALREADY_REGISTERED: "Esta foto já foi registrada.",
  PHOTO_NOT_FOUND: "Foto não encontrada.",
};
export function progressPhotoErrorMessage(err: unknown): string {
  if (err instanceof ProgressPhotoError) return err.message;
  const e = err as { hint?: string; details?: string; message?: string } | null;
  const hint = e?.hint ?? "";
  return PHOTO_HINT_MESSAGES[hint] ?? "Não foi possível concluir. Tente novamente.";
}

export interface UploadPatientPhotoInput {
  patientId: string;
  file: File;
  /** YYYY-MM-DD (dia em que a foto foi tirada; pode ser retroativo) */
  takenOn: string;
  pose: PhotoPose | null;
}

/**
 * Envio de foto pelo PROFISSIONAL (inclusive fotos antigas): sobe o binário para o bucket privado em
 * {patient_id}/{uuid}.ext (a RLS de storage confere o vínculo) e registra a linha pela RPC
 * add_progress_photo_for_patient (que revalida autorização, data, pose, path e existência do arquivo).
 * Se o registro falhar, tenta remover o arquivo órfão (melhor esforço).
 */
export async function uploadProgressPhotoForPatient(input: UploadPatientPhotoInput): Promise<string> {
  const invalid = validatePhotoFile(input.file);
  if (invalid) throw new ProgressPhotoError(invalid);
  const path = photoStorageKey(input.patientId, crypto.randomUUID(), input.file.type);
  const { error: upErr } = await supabase.storage
    .from(PROGRESS_PHOTOS_BUCKET)
    .upload(path, input.file, { contentType: input.file.type, upsert: false });
  if (upErr) {
    captureException(upErr, { source: "storage", scope: "upload-progress-photo-pro" });
    throw new ProgressPhotoError("Não foi possível enviar a foto. Verifique sua permissão e tente de novo.");
  }
  const { data, error } = await supabase.rpc("add_progress_photo_for_patient", {
    p_patient_id: input.patientId,
    p_storage_path: path,
    p_taken_on: input.takenOn,
    p_pose: input.pose,
  });
  if (error) {
    await supabase.storage.from(PROGRESS_PHOTOS_BUCKET).remove([path]).catch(() => undefined);
    throw error;
  }
  return data as string;
}

/** Classifica / reclassifica a posição de uma foto (null = sem posição). */
export async function setProgressPhotoPose(photoId: string, pose: PhotoPose | null): Promise<void> {
  const { error } = await supabase.rpc("set_progress_photo_pose", { p_photo_id: photoId, p_pose: pose });
  if (error) throw error;
}
