// Orquestração + modelo PUROS do relatório de LOTE (WP-REPORT B). O lote é N chamadas SEQUENCIAIS da
// MESMA RPC auditada (1 por paciente, mesmo batch_id) — nenhuma agregação nova no banco. Falha de um
// paciente (ex.: 42501 por vínculo removido) NÃO aborta o lote: registra e segue. Puro/testável.
import type { ReportExportResponse } from "@/lib/api/report";
import { buildPatientReportModel, type PatientReportModel } from "./patientReportModel";

export interface BatchItemResult {
  patientId: string;
  ok: boolean;
  value?: ReportExportResponse;
  error?: unknown;
}

/**
 * Executa a exportação por paciente EM SEQUÊNCIA (não em paralelo — evita rajada). Falha parcial não
 * aborta: cada item vira {ok:true,value} ou {ok:false,error}. `onProgress(done,total)` a cada paciente.
 */
export async function runPatientBatch(
  patientIds: string[],
  exportOne: (patientId: string) => Promise<ReportExportResponse>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ results: BatchItemResult[]; includedCount: number; failedIds: string[] }> {
  const results: BatchItemResult[] = [];
  const total = patientIds.length;
  let done = 0;
  for (const pid of patientIds) {
    try {
      const value = await exportOne(pid);
      results.push({ patientId: pid, ok: true, value });
    } catch (error) {
      results.push({ patientId: pid, ok: false, error });
    }
    done += 1;
    onProgress?.(done, total);
  }
  return {
    results,
    includedCount: results.filter((r) => r.ok).length,
    failedIds: results.filter((r) => !r.ok).map((r) => r.patientId),
  };
}

export interface BatchReportModel {
  generatedAt: string;
  periodLabel: string;
  exportedByName: string;
  clinicName: string;
  total: number;
  includedCount: number;
  failed: Array<{ patientId: string; name: string | null }>;
  patients: PatientReportModel[];
}

function fmtD(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function fmtDateStr(s: unknown): string {
  if (!s || typeof s !== "string") return "—";
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  return isNaN(d.getTime()) ? "—" : fmtD(d);
}

/**
 * Monta o modelo do PDF de lote a partir dos resultados. Reusa buildPatientReportModel por paciente
 * incluído. `failedNameById` resolve o nome dos que falharam (para listar na capa). `now` injetável.
 */
export function buildBatchReportModel(
  results: BatchItemResult[],
  now: Date = new Date(),
  failedNameById: Record<string, string> = {},
): BatchReportModel {
  const included = results.filter((r) => r.ok && r.value);
  const patients = included.map((r) => buildPatientReportModel(r.value as ReportExportResponse, now));
  const failed = results
    .filter((r) => !r.ok)
    .map((r) => ({ patientId: r.patientId, name: failedNameById[r.patientId] ?? null }));

  const firstMeta = (included[0]?.value as ReportExportResponse | undefined)?.meta;
  const periodLabel = firstMeta ? `${fmtDateStr(firstMeta.from)} – ${fmtDateStr(firstMeta.to)}` : "—";
  const exportedByName = firstMeta?.exported_by?.name ?? "—";
  const clinicName = patients[0]?.clinicName ?? "Clínica";

  return {
    generatedAt: fmtD(now),
    periodLabel,
    exportedByName,
    clinicName,
    total: results.length,
    includedCount: included.length,
    failed,
    patients,
  };
}
