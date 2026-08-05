// Exportação de relatório de UM paciente — o ÚNICO caminho para o pacote agregado é a RPC
// public.export_patient_report (WP-REPORT A). A RPC autoriza, GRAVA a trilha de auditoria e retorna
// os dados; o cliente NÃO busca o pacote por outra via. Erro 42501 = autorização negada (nada gravado).
import { supabase } from "@/lib/supabase";

/** Seções conhecidas (espelho da lista fixa validada na RPC — A2). */
export const REPORT_SECTIONS = [
  "identity",
  "weight",
  "anthropometry",
  "workout_plan",
  "nutrition_plan",
  "supplements",
  "adherence",
  "recovery",
  "workout_execution",
  "documents",
  "appointments",
  "photos",
  "achievements",
  "timeline",
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

/** Conjunto padrão exportado pelo botão (essenciais + planos + adesão). */
export const DEFAULT_REPORT_SECTIONS: ReportSection[] = [
  "identity",
  "weight",
  "anthropometry",
  "workout_plan",
  "nutrition_plan",
  "supplements",
  "adherence",
  "recovery",
];

/**
 * Teto de pacientes por LOTE. Justificativa: o lote é N chamadas SEQUENCIAIS da RPC (1 por paciente);
 * 50 mantém a operação responsiva (poucos minutos no pior caso), o PDF único num tamanho gerenciável
 * (≤50 blocos), e evita rajada contra o banco. Acima disso, recusar com mensagem clara.
 */
export const MAX_BATCH_PATIENTS = 50;

export interface ReportExportInput {
  patientId: string;
  /** YYYY-MM-DD */
  from: string;
  to: string;
  sections: ReportSection[];
  surface?: string;
  /** Agrupa as linhas da trilha de um mesmo lote (null/omitido = exportação individual). */
  batchId?: string | null;
}

export interface ReportExportResponse {
  meta: {
    patient_id: string;
    from: string;
    to: string;
    sections: string[];
    record_count: number;
    truncated: boolean;
    generated_at: string;
    exported_by: { profile_id: string | null; name: string | null };
  };
  patient: Record<string, unknown> | null;
  sections: Record<string, unknown>;
}

/** Chama a RPC de exportação (autoriza + audita + retorna). Lança em erro (inclui 42501 = negado). */
export async function exportPatientReport(input: ReportExportInput): Promise<ReportExportResponse> {
  const { data, error } = await supabase.rpc("export_patient_report", {
    p_patient_id: input.patientId,
    p_from: input.from,
    p_to: input.to,
    p_sections: input.sections,
    p_surface: input.surface ?? "web",
    p_batch_id: input.batchId ?? null,
  });
  if (error) throw error;
  return data as ReportExportResponse;
}

/** true quando o erro é autorização negada pela RPC (Postgres 42501 = insufficient_privilege). */
export function isReportAuthzError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === "42501" || /not authorized/i.test(e?.message ?? "");
}

// ── Trilha de auditoria (WP-REPORT B · Parte 3) — leitura escopada pela RLS (admin da clínica OU autor).
export interface ReportExportRow {
  id: string;
  exportedAt: string;
  periodFrom: string;
  periodTo: string;
  sections: string[];
  recordCount: number;
  batchId: string | null;
  authorName: string | null;
  patientName: string | null;
}
export interface ReportExportFilters {
  /** YYYY-MM-DD (exported_at >= from 00:00) */
  from?: string | null;
  /** YYYY-MM-DD (exported_at <= to 23:59:59) */
  to?: string | null;
  professionalProfileId?: string | null;
  patientId?: string | null;
}
interface RawReportExportRow {
  id: string;
  exported_at: string;
  period_from: string;
  period_to: string;
  sections: string[];
  record_count: number;
  batch_id: string | null;
  author: { full_name: string | null } | null;
  patient: { profile: { full_name: string | null } | null } | null;
}

/** Lista as exportações (mais recentes primeiro), paginado. A RLS garante que só admin da clínica ou o
 *  próprio autor recebem linhas — a tela NÃO busca conteúdo clínico (a trilha não tem). */
export async function listReportExports(
  filters: ReportExportFilters,
  page: number,
  pageSize: number,
): Promise<{ rows: ReportExportRow[]; total: number }> {
  let q = supabase
    .from("report_exports")
    .select(
      "id, exported_at, period_from, period_to, sections, record_count, batch_id, " +
        "author:profiles!exported_by_profile_id ( full_name ), " +
        "patient:patients!patient_id ( profile:profiles ( full_name ) )",
      { count: "exact" },
    )
    .order("exported_at", { ascending: false });

  if (filters.from) q = q.gte("exported_at", `${filters.from}T00:00:00`);
  if (filters.to) q = q.lte("exported_at", `${filters.to}T23:59:59`);
  if (filters.professionalProfileId) q = q.eq("exported_by_profile_id", filters.professionalProfileId);
  if (filters.patientId) q = q.eq("patient_id", filters.patientId);

  const fromIdx = page * pageSize;
  const { data, error, count } = await q.range(fromIdx, fromIdx + pageSize - 1);
  if (error) throw error;

  const rows = ((data ?? []) as unknown as RawReportExportRow[]).map((r) => ({
    id: r.id,
    exportedAt: r.exported_at,
    periodFrom: r.period_from,
    periodTo: r.period_to,
    sections: r.sections ?? [],
    recordCount: r.record_count,
    batchId: r.batch_id,
    authorName: r.author?.full_name ?? null,
    patientName: r.patient?.profile?.full_name ?? null,
  }));
  return { rows, total: count ?? 0 };
}

/** Profissionais da clínica (profile_id + nome) para o filtro da auditoria. RLS escopa à clínica do admin. */
export async function listClinicProfessionalProfiles(
  clinicId: string,
): Promise<Array<{ profileId: string; name: string }>> {
  const { data, error } = await supabase
    .from("professionals")
    .select("profile_id, profile:profiles!professionals_profile_id_fkey ( full_name )")
    .eq("clinic_id", clinicId);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{ profile_id: string; profile: { full_name: string | null } | null }>).map(
    (r) => ({ profileId: r.profile_id, name: r.profile?.full_name ?? "Profissional" }),
  );
}
