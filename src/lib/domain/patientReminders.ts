// Lembretes de exame e retorno (A2, redesign P6) — regras PURAS. Datas em America/Sao_Paulo: "hoje" vem de todayIsoBR
// (nunca toISOString) e a conta de dias é feita sobre AAAA-MM-DD, sem hora, então não muda de dia por fuso.
// O aviso é DERIVADO na leitura (sem cron): uma linha por lembrete; mudou a data, muda a linha; apagou, some.
import { todayIsoBR } from "./stockMoves";

export type ReminderKind = "exam" | "return";

export interface ReminderRow {
  id: string;
  patient_id: string;
  kind: ReminderKind;
  title: string | null;
  /** AAAA-MM-DD (coluna date, sem fuso). */
  due_on: string;
  notify_patient: boolean;
  notify_days_before: number;
  pro_notify_days_before: number;
  message_template: string | null;
  done_at: string | null;
}

/** Dias que o card ainda aparece para o paciente depois da data (depois some sozinho; a equipe continua vendo até marcar como feito). */
export const PATIENT_GRACE_DAYS = 7;
export const MAX_MESSAGE_LENGTH = 500;
export const MAX_NOTICE_DAYS = 90;
export const NOTICE_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 0, label: "No dia" },
  { days: 1, label: "1 dia antes" },
  { days: 3, label: "3 dias antes" },
  { days: 7, label: "7 dias antes" },
  { days: 14, label: "14 dias antes" },
  { days: 30, label: "30 dias antes" },
];

export const DEFAULT_NOTICE_DAYS = { exam: 7, return: 7 } as const;
export const DEFAULT_TEMPLATES: Record<ReminderKind, string> = {
  return: "Olá, {nome}! Seu retorno com a clínica é {quando}, em {data}. Se precisar remarcar, fale com a sua equipe pelo app.",
  exam: "Olá, {nome}! Lembrete: o exame {exame} deve ser feito até {data} ({quando}). Quando tiver o resultado, avise a sua equipe pelo app.",
};
export const TEMPLATE_TOKENS = ["{nome}", "{data}", "{quando}", "{exame}"] as const;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const utcDay = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** Dias de `todayIso` até `dueIso` (positivo = ainda falta). Só calendário, sem hora. */
export function daysUntil(dueIso: string, todayIso: string): number {
  return Math.round(utcDay(dueIso) - utcDay(todayIso));
}

export function isoDateBRText(iso: string): string {
  return ISO.test(iso) ? iso.split("-").reverse().join("/") : "—";
}

/** "hoje", "amanhã", "em 5 dias", "ontem", "há 3 dias". */
export function whenText(days: number): string {
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  if (days === -1) return "ontem";
  return days > 0 ? `em ${days} dias` : `há ${-days} dias`;
}

export type ReminderPhase = "futuro" | "aviso" | "hoje" | "atrasado" | "encerrado" | "feito";

/** Fase do lembrete para uma janela de aviso (`leadDays`) e uma tolerância depois da data (`graceDays`; Infinity = até marcar como feito). */
export function reminderPhase(r: Pick<ReminderRow, "due_on" | "done_at">, todayIso: string, leadDays: number, graceDays: number): ReminderPhase {
  if (r.done_at) return "feito";
  const d = daysUntil(r.due_on, todayIso);
  if (d > leadDays) return "futuro";
  if (d > 0) return "aviso";
  if (d === 0) return "hoje";
  return -d <= graceDays ? "atrasado" : "encerrado";
}

const SHOWN: ReminderPhase[] = ["aviso", "hoje", "atrasado"];

/** Aparece no app do paciente? (opt-in do cadastro + janela de aviso + tolerância depois da data). */
export function patientSees(r: ReminderRow, todayIso: string): boolean {
  return r.notify_patient && SHOWN.includes(reminderPhase(r, todayIso, r.notify_days_before, PATIENT_GRACE_DAYS));
}

/** Aparece no Hoje do profissional? (janela própria; atrasado fica até marcar como feito ou apagar). */
export function proSees(r: ReminderRow, todayIso: string): boolean {
  return SHOWN.includes(reminderPhase(r, todayIso, r.pro_notify_days_before, Number.POSITIVE_INFINITY));
}

export function firstName(full: string | null | undefined): string {
  const w = (full ?? "").trim().split(/\s+/)[0];
  return w || "tudo bem";
}

export interface RenderContext {
  name: string | null | undefined;
  dueOn: string;
  title: string | null;
  kind: ReminderKind;
  todayIso: string;
}

/** Texto do lembrete para o paciente: modelo da clínica (ou o padrão) com {nome} {data} {quando} {exame} preenchidos. */
export function renderReminderMessage(template: string | null | undefined, ctx: RenderContext): string {
  const tpl = template && template.trim() ? template : DEFAULT_TEMPLATES[ctx.kind];
  const map: Record<string, string> = {
    "{nome}": firstName(ctx.name),
    "{data}": isoDateBRText(ctx.dueOn),
    "{quando}": whenText(daysUntil(ctx.dueOn, ctx.todayIso)),
    "{exame}": ctx.title?.trim() || "pedido",
  };
  return tpl.replace(/\{(nome|data|quando|exame)\}/g, (m) => map[m]).replace(/\s+/g, " ").trim();
}

export function reminderHeadline(r: Pick<ReminderRow, "kind" | "title">): string {
  return r.kind === "return" ? "Retorno" : `Exame: ${r.title ?? "sem nome"}`;
}

export interface ReminderInput {
  kind: ReminderKind;
  title: string;
  dueOn: string;
  noticeDays: number;
  proNoticeDays: number;
  message: string;
}

/** Mensagem de erro em PT ou null se o formulário está válido (mesmas regras da função do banco). */
export function validateReminderInput(i: ReminderInput, todayIso: string = todayIsoBR()): string | null {
  if (i.kind === "exam" && !i.title.trim()) return "Informe o nome do exame.";
  if (i.title.trim().length > 80) return "O nome do exame pode ter até 80 letras.";
  if (!ISO.test(i.dueOn) || Number.isNaN(utcDay(i.dueOn))) return "Informe a data.";
  const d = daysUntil(i.dueOn, todayIso);
  if (d < -365) return "A data não pode ser de mais de um ano atrás.";
  if (d > 3650) return "A data está longe demais.";
  for (const n of [i.noticeDays, i.proNoticeDays]) {
    if (!Number.isInteger(n) || n < 0 || n > MAX_NOTICE_DAYS) return `Avisar de 0 a ${MAX_NOTICE_DAYS} dias antes.`;
  }
  if (i.message.length > MAX_MESSAGE_LENGTH) return `A mensagem pode ter até ${MAX_MESSAGE_LENGTH} letras.`;
  return null;
}

export interface ProReminderLine {
  id: string;
  patientId: string;
  patientName: string;
  headline: string;
  when: string;
  /** "Exame: Hemograma · em 5 dias" — o prazo fica junto do título; a data vai na linha de baixo. */
  summary: string;
  /** "21/11/2026" */
  dueText: string;
  days: number;
  overdue: boolean;
}

/** Linhas do Hoje do profissional: só as dentro da janela dele, atrasados e mais próximos primeiro. */
export function proReminderLines(rows: Array<ReminderRow & { patientName: string }>, todayIso: string): ProReminderLine[] {
  return rows
    .filter((r) => proSees(r, todayIso))
    .map((r) => {
      const days = daysUntil(r.due_on, todayIso);
      return { id: r.id, patientId: r.patient_id, patientName: r.patientName, headline: reminderHeadline(r), when: whenText(days), summary: `${reminderHeadline(r)} · ${whenText(days)}`, dueText: isoDateBRText(r.due_on), days, overdue: days < 0 };
    })
    .sort((a, b) => a.days - b.days || a.patientName.localeCompare(b.patientName, "pt-BR"));
}

/** Campos do retorno no cadastro do paciente (formulário). */
export interface ReturnReminderForm {
  dueOn: string;
  notify: boolean;
  days: number;
  message: string;
}
export const EMPTY_RETURN_REMINDER: ReturnReminderForm = { dueOn: "", notify: true, days: DEFAULT_NOTICE_DAYS.return, message: DEFAULT_TEMPLATES.return };
