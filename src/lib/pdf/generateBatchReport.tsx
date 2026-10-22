/**
 * Orquestra o Relatório em LOTE (WP-REPORT B). Gera um batch_id no cliente, chama a MESMA RPC auditada
 * export_patient_report UMA VEZ POR PACIENTE (em sequência), monta um PDF único (capa + 1 bloco por
 * paciente) e dispara o download. Falha de um paciente NÃO aborta o lote. Sem função de agregação nova.
 */
import { pdf } from "@react-pdf/renderer";

import { BatchReportDoc } from "./BatchReport";
import { buildBatchReportModel, runPatientBatch } from "./batchReportModel";
import { registerReportFonts } from "./fonts";
import { exportPatientReport, DEFAULT_REPORT_SECTIONS, MAX_BATCH_PATIENTS, type ReportSection } from "@/lib/api/report";
import { blobToBytes, buildZip, zipEntryName } from "./batchZip";
import { generatePatientReportBlob } from "./generatePatientReport";

export interface BatchReportInput {
  patientIds: string[];
  from: string;
  to: string;
  sections: ReportSection[];
  /** Nome por patientId — usado só para LISTAR os que falharam na capa (a trilha/RPC não expõem nome do que negou). */
  patientNames?: Record<string, string>;
}

export interface BatchReportOutcome {
  includedCount: number;
  failedIds: string[];
  total: number;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Executa o lote e baixa o PDF. `onProgress(done,total)` para o indicador ("3 de 12"). Lança se o teto
 * de pacientes for excedido (antes de qualquer chamada). Retorna o resumo (incluídos/falhados).
 */
export async function downloadBatchReport(
  input: BatchReportInput,
  onProgress?: (done: number, total: number) => void,
  now: Date = new Date(),
): Promise<BatchReportOutcome> {
  if (input.patientIds.length === 0) throw new Error("Selecione ao menos um paciente.");
  if (input.patientIds.length > MAX_BATCH_PATIENTS) {
    throw new Error(`Selecione no máximo ${MAX_BATCH_PATIENTS} pacientes por lote.`);
  }

  const batchId = crypto.randomUUID();
  const { results, includedCount, failedIds } = await runPatientBatch(
    input.patientIds,
    (patientId) => exportPatientReport({ patientId, from: input.from, to: input.to, sections: input.sections, surface: "web", batchId }),
    onProgress,
  );

  const model = buildBatchReportModel(results, now, input.patientNames ?? {});
  registerReportFonts();
  const blob = await pdf(<BatchReportDoc model={model} />).toBlob();

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-lote-${ymd(now)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }

  return { includedCount, failedIds, total: input.patientIds.length };
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Lote em ZIP: UM PDF POR PACIENTE (relatório individual completo), baixados num único arquivo. Mesma RPC auditada,
 * mesmo batch_id, em sequência; um paciente que falha (autorização, erro ao montar o PDF) não derruba os outros.
 * `onProgress` conta cada paciente quando o PDF dele fica pronto.
 */
export async function downloadBatchZip(
  input: BatchReportInput,
  onProgress?: (done: number, total: number) => void,
  now: Date = new Date(),
): Promise<BatchReportOutcome> {
  if (input.patientIds.length === 0) throw new Error("Selecione ao menos um paciente.");
  if (input.patientIds.length > MAX_BATCH_PATIENTS) throw new Error(`Selecione no máximo ${MAX_BATCH_PATIENTS} pacientes por lote.`);

  const batchId = crypto.randomUUID();
  const sections = input.sections.length > 0 ? input.sections : DEFAULT_REPORT_SECTIONS;
  const used = new Set<string>();
  const files: { name: string; data: Uint8Array }[] = [];
  const failedIds: string[] = [];
  let done = 0;
  for (const patientId of input.patientIds) {
    try {
      const rpc = await exportPatientReport({ patientId, from: input.from, to: input.to, sections, surface: "web", batchId });
      const { blob, patientName } = await generatePatientReportBlob(rpc, now);
      files.push({ name: zipEntryName(patientName, used), data: await blobToBytes(blob) });
    } catch {
      failedIds.push(patientId);
    }
    done += 1;
    onProgress?.(done, input.patientIds.length);
  }
  if (files.length === 0) throw new Error("Nenhum relatório pôde ser gerado.");
  downloadBlob(new Blob([buildZip(files) as BlobPart], { type: "application/zip" }), `relatorios-${ymd(now)}.zip`);
  return { includedCount: files.length, failedIds, total: input.patientIds.length };
}
