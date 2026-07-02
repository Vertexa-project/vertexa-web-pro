import { supabase } from "@/lib/supabase";
import type { DocumentUploaderRole, PatientDocument, PatientDocumentView } from "@/types/db";

// Bucket PRIVADO de documentos/exames (migration 20260702230000). Sem URL pública:
// download só via createSignedUrl (TTL curto). NÃO confundir com 'progress-photos' (público).
const BUCKET = "patient-documents";

/** Tipos MIME aceitos (PDF + imagens comuns). A barreira real é o servidor/RLS (#14). */
export const ALLOWED_DOCUMENT_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const MAX_DOCUMENT_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
const SIGNED_URL_TTL_SECONDS = 600; // 10 min

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface UploadPatientDocumentInput {
  patientId: string;
  file: File;
  kind?: string; // 'exam' | 'report' | 'other' (texto flexível)
  title?: string | null;
  uploadedByRole?: DocumentUploaderRole; // default 'professional' (a web); 'patient' é o app (futuro)
  uploadedByProfessionalId?: string | null; // professionals.id (null quando o paciente envia)
}

function extFor(file: File): string {
  const byMime = EXT_BY_MIME[file.type];
  if (byMime) return byMime;
  const fromName = file.name?.split(".").pop()?.toLowerCase();
  return fromName && /^[a-z0-9]{2,5}$/.test(fromName) ? fromName : "bin";
}

/**
 * Sobe um documento/exame (PDF/imagem) para o bucket PRIVADO 'patient-documents' e registra a
 * linha em patient_documents. Valida mime (pdf/jpeg/png/webp) e tamanho (<=15MB) no client — a
 * autorização real é a RLS/servidor (#14). Grava file_path = CAMINHO do objeto (não URL pública);
 * o download é via getDocumentSignedUrl(). Modelo bidirecional: uploadedByRole distingue o
 * profissional (web, esta sessão) do paciente (app, futuro — professional_id sempre NULL).
 */
export async function uploadPatientDocument(
  input: UploadPatientDocumentInput,
): Promise<PatientDocument> {
  const {
    patientId,
    file,
    kind = "exam",
    title = null,
    uploadedByRole = "professional",
    uploadedByProfessionalId = null,
  } = input;

  if (!patientId) throw new Error("Paciente não informado.");
  if (!file) throw new Error("Arquivo não informado.");
  if (!ALLOWED_DOCUMENT_MIME.includes(file.type as (typeof ALLOWED_DOCUMENT_MIME)[number])) {
    throw new Error("Formato não suportado. Envie PDF, JPG, PNG ou WEBP.");
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    throw new Error("Arquivo muito grande. O limite é 15 MB.");
  }

  // Pasta = patient_id (base da RLS real por paciente/pasta na S9). Nome único por timestamp.
  const path = `${patientId}/${Date.now()}.${extFor(file)}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("patient_documents")
    .insert({
      patient_id: patientId,
      uploaded_by_role: uploadedByRole,
      // paciente NUNCA carrega professional_id (auditoria coerente com o modelo bidirecional)
      uploaded_by_professional_id: uploadedByRole === "patient" ? null : uploadedByProfessionalId,
      kind,
      title: title?.trim() || null,
      file_path: path,
      mime_type: file.type || null,
      file_size_bytes: file.size,
    })
    .select("*")
    .single();

  if (error) {
    // Best-effort: remove o objeto órfão se a linha não gravou (no-op na sprint sem policy de
    // DELETE — passa a limpar de fato quando a RLS real adicionar o DELETE escopado).
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }

  return data as PatientDocument;
}

interface RawProfessionalNameRow {
  id: string;
  profile: { full_name: string | null } | null;
}

/**
 * Documentos/exames do paciente, mais recentes primeiro. Resolve o NOME de quem enviou
 * (uploaded_by_professional_id -> professionals -> profiles.full_name) num segundo select com
 * `.in` (evita embed custoso na leitura principal). A web só LÊ patient_documents por aqui.
 * Documento enviado pelo paciente (futuro, app) não tem professional_id → nome fica null.
 */
export async function listPatientDocuments(patientId: string): Promise<PatientDocumentView[]> {
  const { data, error } = await supabase
    .from("patient_documents")
    .select("*")
    .eq("patient_id", patientId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as PatientDocument[];
  if (rows.length === 0) return [];

  const professionalIds = Array.from(
    new Set(
      rows
        .map((r) => r.uploaded_by_professional_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const nameById = new Map<string, string | null>();
  if (professionalIds.length > 0) {
    const { data: profs, error: profErr } = await supabase
      .from("professionals")
      .select("id, profile:profiles ( full_name )")
      .in("id", professionalIds);
    if (profErr) throw profErr;
    for (const p of (profs ?? []) as unknown as RawProfessionalNameRow[]) {
      nameById.set(p.id, p.profile?.full_name ?? null);
    }
  }

  return rows.map((r) => ({
    ...r,
    uploaded_by_name:
      r.uploaded_by_role === "patient"
        ? null // nome do paciente será resolvido pelo lado do app no futuro
        : r.uploaded_by_professional_id
          ? (nameById.get(r.uploaded_by_professional_id) ?? null)
          : null,
  }));
}

/**
 * URL assinada (TTL 10 min) para abrir/baixar um documento do bucket PRIVADO. Gerada NO CLIQUE
 * (não persistida) para nunca expor URL pública de dado de saúde. Sempre https (Supabase).
 */
export async function getDocumentSignedUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Não foi possível gerar o link do documento.");
  return data.signedUrl;
}
