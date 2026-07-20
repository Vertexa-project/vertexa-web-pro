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

export interface ReportExportInput {
  patientId: string;
  /** YYYY-MM-DD */
  from: string;
  to: string;
  sections: ReportSection[];
  surface?: string;
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
  });
  if (error) throw error;
  return data as ReportExportResponse;
}

/** true quando o erro é autorização negada pela RPC (Postgres 42501 = insufficient_privilege). */
export function isReportAuthzError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === "42501" || /not authorized/i.test(e?.message ?? "");
}
