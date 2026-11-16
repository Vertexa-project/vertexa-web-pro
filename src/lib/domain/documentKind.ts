// Tipo do documento enviado pela web (patient_documents.kind). Puro.
import type { PatientDocumentKind } from "@/types/db";

export const DOCUMENT_KIND_LABELS: Record<PatientDocumentKind, string> = {
  exam: "Exame",
  report: "Relatório",
  other: "Outro",
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Sugere o tipo pelo nome do arquivo. Relatórios gerados pelo Vertexa ("evolucao-…", "pontos-…") e
 * nomes com "relatório/progresso/evolução" => report (antes TODO envio virava Exame).
 * Sem pista => "other" (nunca chuta Exame). O profissional pode trocar depois.
 */
export function inferDocumentKind(fileName: string | null | undefined): PatientDocumentKind {
  const n = norm(fileName ?? "");
  if (/relat|progress|evolu|^pontos[-_ ]/.test(n)) return "report";
  if (/exame|hemograma|laudo|resultado|ferritina|glicemia|colesterol|tsh|ultrassom|ressonancia|raio[- ]?x/.test(n)) return "exam";
  return "other";
}

export function isDocumentKind(v: string): v is PatientDocumentKind {
  return v === "exam" || v === "report" || v === "other";
}
