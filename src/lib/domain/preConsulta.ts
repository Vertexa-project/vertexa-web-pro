// Pré-consulta (A1): tipos, perguntas padrão e "Resumo para a consulta" em modo demonstração (determinístico, sem IA).
// As perguntas padrão espelham private.pre_consulta_default_questions() na migration 20261124100000 (roteiro de anamnese da reunião).

export type PreConsultaStatus = "enviada" | "rascunho" | "respondida" | "cancelada";
export type QuestionType = "short" | "long";
export interface PreConsultaQuestion { id: string; label: string; type: QuestionType }

export interface PreConsultaRow {
  id: string;
  patient_id: string;
  appointment_id: string | null;
  appointment_starts_at: string | null;
  status: PreConsultaStatus;
  source: "auto" | "manual";
  questions: PreConsultaQuestion[];
  answers: Record<string, string>;
  sent_at: string;
  answered_at: string | null;
  canceled_at: string | null;
}

export interface PreConsultaFile { document_id: string; title: string | null; file_path: string; mime_type: string | null }

export const DEFAULT_QUESTIONS: PreConsultaQuestion[] = [
  { id: "objetivo", label: "Qual é o seu principal objetivo com o acompanhamento?", type: "long" },
  { id: "peso_atual", label: "Quanto você pesa e mede hoje? (pode ser aproximado)", type: "short" },
  { id: "historico_peso", label: "Como seu peso variou nos últimos anos? Teve fases de ganho ou perda?", type: "long" },
  { id: "rotina", label: "Como é a sua rotina de trabalho e de sono? (horários e horas de sono por noite)", type: "long" },
  { id: "alimentacao", label: "Como é a sua alimentação em um dia comum? Quantas refeições faz e em que horários?", type: "long" },
  { id: "alimentacao_emocional", label: "Passa por períodos de pouca comida, exagero ou de comer por ansiedade ou emoção? Conte como acontece.", type: "long" },
  { id: "atividade", label: "Que atividade física você pratica hoje e quantas vezes por semana?", type: "short" },
  { id: "saude", label: "Tem alguma doença, cirurgia ou sintoma que a equipe deva saber? (ex.: gastrite, refluxo, pressão)", type: "long" },
  { id: "medicacoes", label: "Usa medicamentos, suplementos ou hormônios? Quais e em que dose?", type: "long" },
  { id: "exames", label: "Fez exames de sangue ou de imagem recentes? Se tiver, anexe nesta tela.", type: "short" },
  { id: "emocional", label: "Como estão seu estresse, humor e ansiedade ultimamente?", type: "long" },
  { id: "duvidas", label: "Tem mais alguma coisa que queira contar ou perguntar na consulta?", type: "long" },
];

export const MAX_QUESTIONS = 20;
export const MAX_LABEL = 240;

/** "2026-11-24T13:00:00Z" → "24/11" em America/Sao_Paulo. */
export function dayMonthBR(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(d);
}

/** Estado exibido na ficha: "Enviada", "Respondida em dd/mm" etc. */
export function statusText(r: Pick<PreConsultaRow, "status" | "answered_at" | "sent_at">): string {
  switch (r.status) {
    case "respondida": return `Respondida em ${dayMonthBR(r.answered_at)}`;
    case "rascunho": return "Paciente começou a responder";
    case "cancelada": return "Cancelada";
    default: return `Enviada em ${dayMonthBR(r.sent_at)}`;
  }
}

/** O pedido em andamento (o mais recente que não foi cancelado). */
export function currentOf(rows: PreConsultaRow[]): PreConsultaRow | null {
  const live = rows.filter((r) => r.status !== "cancelada");
  return live.length ? live.reduce((a, b) => (a.sent_at >= b.sent_at ? a : b)) : null;
}

/** Identificador da pergunta + resposta, na ordem das perguntas do pedido; só o que o paciente respondeu. */
export function answeredPairs(r: Pick<PreConsultaRow, "questions" | "answers">): Array<{ q: PreConsultaQuestion; a: string }> {
  return r.questions.map((q) => ({ q, a: (r.answers[q.id] ?? "").trim() })).filter((x) => x.a !== "");
}

const clip = (s: string, max = 150): string => {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return `${(stop > 60 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, "")).trim()}…`;
};

const SUMMARY_GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: "Objetivo", ids: ["objetivo"] },
  { label: "Peso", ids: ["peso_atual", "historico_peso"] },
  { label: "Saúde e medicações", ids: ["saude", "medicacoes"] },
  { label: "Alimentação e rotina", ids: ["alimentacao", "alimentacao_emocional", "rotina"] },
  { label: "Emocional", ids: ["emocional"] },
  { label: "Atividade física", ids: ["atividade"] },
  { label: "Dúvidas", ids: ["duvidas"] },
];

/**
 * "Resumo para a consulta": até 5 linhas, MODO DEMONSTRAÇÃO (sem IA): só reaproveita, recortado, o que o paciente respondeu —
 * nada é inventado. Perguntas editadas pela clínica (ids fora do roteiro padrão) entram com o texto da própria pergunta.
 * Pronto para trocar por OPENAI_API_KEY quando existir; o selo "Modo demonstração" fica na tela.
 */
export function buildSummary(r: Pick<PreConsultaRow, "questions" | "answers">, fileCount: number): string[] {
  const byId = new Map(r.questions.map((q) => [q.id, q] as const));
  const answer = (id: string) => (r.answers[id] ?? "").trim();
  const lines: string[] = [];
  const known = new Set(SUMMARY_GROUPS.flatMap((g) => g.ids));
  for (const g of SUMMARY_GROUPS) {
    const parts = g.ids.filter((id) => byId.has(id) && answer(id)).map((id) => answer(id));
    if (parts.length) lines.push(`${g.label}: ${clip(parts.join(" · "))}`);
  }
  for (const q of r.questions) {
    if (!known.has(q.id) && q.id !== "exames" && answer(q.id)) lines.push(`${clip(q.label.replace(/[?:]\s*$/, ""), 60)}: ${clip(answer(q.id), 110)}`);
  }
  const exam = answer("exames");
  const examLine = fileCount > 0
    ? `Exames: ${fileCount === 1 ? "1 arquivo anexado" : `${fileCount} arquivos anexados`}${exam ? ` · ${clip(exam, 90)}` : ""}`
    : exam ? `Exames: ${clip(exam)}` : null;
  if (examLine) {
    if (lines.length >= 5) lines.splice(4, lines.length - 4, examLine);
    else lines.push(examLine);
  }
  return lines.slice(0, 5);
}

/** Valida a lista de perguntas da Configurações (mesmas regras da RPC). Devolve a mensagem de erro ou null. */
export function validateQuestions(qs: PreConsultaQuestion[]): string | null {
  if (qs.length < 1) return "Deixe ao menos uma pergunta.";
  if (qs.length > MAX_QUESTIONS) return `No máximo ${MAX_QUESTIONS} perguntas.`;
  if (qs.some((q) => q.label.trim().length < 3)) return "Preencha o texto de todas as perguntas.";
  if (qs.some((q) => q.label.trim().length > MAX_LABEL)) return `Cada pergunta pode ter até ${MAX_LABEL} caracteres.`;
  return null;
}

/** Id novo e único para pergunta criada na Configurações (minúsculas, números e _). */
export function newQuestionId(existing: string[]): string {
  let i = existing.length + 1;
  while (existing.includes(`pergunta_${i}`)) i += 1;
  return `pergunta_${i}`;
}
