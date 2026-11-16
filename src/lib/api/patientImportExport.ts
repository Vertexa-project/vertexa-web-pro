// Importar pacientes por planilha e exportar a base (redesign parte 4). Toda escrita passa por RPC no servidor
// (import_patients, export_patients); a tela nunca grava paciente nem auditoria direto.
import { supabase } from "@/lib/supabase";
import type { ExistingPatientKey, ImportRpcRow } from "@/lib/domain/patientImport";
import type { ExportGroup, ExportReasonKind, ExportRow } from "@/lib/domain/patientExport";

export interface ImportLineResult {
  line: number;
  status: "importado" | "duplicado" | "erro";
  reason?: string;
  patient_id?: string;
}

export interface ImportPatientsResult {
  batch_id: string;
  imported: number;
  duplicates: number;
  errors: number;
  results: ImportLineResult[];
}

export interface PatientExportRecord {
  id: string;
  actor_name: string | null;
  reason_kind: string;
  reason_text: string;
  fields: string[];
  row_count: number;
  created_at: string;
}

export interface PatientImportOrigin {
  source_filename: string;
  imported_at: string;
}

export async function getImportDedupeKeys(clinicId: string): Promise<ExistingPatientKey[]> {
  const { data, error } = await supabase.rpc("patient_import_dedupe_keys", { p_clinic: clinicId });
  if (error) throw error;
  return ((data ?? []) as Array<{ email: string | null; name: string; birth_date: string | null; phone_key: string | null }>).map((k) => ({
    email: k.email,
    name: k.name,
    birth_date: k.birth_date,
    phone_key: k.phone_key,
  }));
}

export async function importPatients(clinicId: string, filename: string, rows: ImportRpcRow[]): Promise<ImportPatientsResult> {
  const { data, error } = await supabase.rpc("import_patients", { p_clinic: clinicId, p_filename: filename, p_rows: rows });
  if (error) throw error;
  return data as ImportPatientsResult;
}

export async function exportPatients(
  clinicId: string,
  groups: ExportGroup[],
  kind: ExportReasonKind,
  reason: string,
): Promise<{ export_id: string; row_count: number; rows: ExportRow[] }> {
  const { data, error } = await supabase.rpc("export_patients", {
    p_clinic: clinicId,
    p_fields: groups,
    p_reason_kind: kind,
    p_reason: reason.trim(),
  });
  if (error) throw error;
  return data as { export_id: string; row_count: number; rows: ExportRow[] };
}

/** Lista "Exportações" (RLS: só o admin da clínica lê). */
export async function listPatientExports(clinicId: string, limit = 50): Promise<PatientExportRecord[]> {
  const { data, error } = await supabase
    .from("patient_exports")
    .select("id, actor_name, reason_kind, reason_text, fields, row_count, created_at")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PatientExportRecord[];
}

export async function getPatientImportOrigin(patientId: string): Promise<PatientImportOrigin | null> {
  const { data, error } = await supabase
    .from("patient_import_origin")
    .select("source_filename, imported_at")
    .eq("patient_id", patientId)
    .maybeSingle();
  if (error) throw error;
  return (data as PatientImportOrigin | null) ?? null;
}

const HINTS: Record<string, string> = {
  PATIENT_IMPORT_ADMIN_REQUIRED: "Só o administrador da clínica importa pacientes.",
  PATIENT_IMPORT_TOO_MANY: "O arquivo passa de 500 pacientes. Divida em partes.",
  PATIENT_IMPORT_EMPTY: "Não há nenhum paciente para importar.",
  CLINIC_NOT_OPERATIONAL: "A clínica está sem acesso ativo no momento.",
  PATIENT_EXPORT_MANAGER_REQUIRED: "Só o Gestor ou o administrador da clínica exporta a base.",
  PATIENT_EXPORT_REASON_REQUIRED: "Informe o motivo da exportação.",
  PATIENT_EXPORT_FIELDS_INVALID: "Escolha ao menos um grupo de dados.",
  PATIENT_EXPORT_TOO_LARGE: "A base é grande demais para uma exportação só. Fale com o suporte.",
  BILLING_PATIENT_CAPACITY: "A clínica atingiu o limite de pacientes ativos do plano. Nada foi importado.",
  NOT_AUTHENTICATED: "Sua sessão expirou. Entre novamente.",
};

/** Mensagem em português para o erro de uma das RPCs (a dica do servidor vira texto; o resto é genérico). */
export function importExportErrorMessage(err: unknown, fallback: string): string {
  const e = err as { hint?: unknown; message?: unknown } | null;
  const text = `${typeof e?.hint === "string" ? e.hint : ""} ${typeof e?.message === "string" ? e.message : ""}`;
  for (const [k, v] of Object.entries(HINTS)) if (text.includes(k)) return v;
  return fallback;
}
