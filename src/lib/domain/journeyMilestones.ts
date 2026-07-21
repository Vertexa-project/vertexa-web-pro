// MARCOS DERIVADOS da jornada (WP-KANBAN B). Função PURA — NÃO existe tabela de marcos: tudo é
// calculado de patients.start_date, patients.birth_date e dos offsets (espelho de
// private.journey_day_offsets = {30,60,90}). Só o RECONHECIMENTO é materializado (journey_milestone_ack).
// `today` é injetável para tornar o cálculo determinístico nos testes. MARCO NÃO MOVE CARTÃO.
import { addDays, differenceInCalendarDays, format, getDaysInMonth, parseISO } from "date-fns";

import { JOURNEY_DAY_OFFSETS } from "./journeyOffsets";

export type MilestoneStatus = "past" | "upcoming" | "future";
export type MilestoneKind = "start" | "birthday" | "day";

export interface Milestone {
  /** Chave CANÔNICA, idêntica à validada pela RPC: 'start' | 'birthday:YYYY' | 'day_<offset>'. */
  key: string;
  kind: MilestoneKind;
  /** Rótulo PT-BR curto para o selo. */
  label: string;
  /** Data exata do marco, 'yyyy-MM-dd'. */
  date: string;
  /** Dias de calendário até a data (negativo = já ocorreu; 0 = hoje). */
  daysUntil: number;
  status: MilestoneStatus;
  /** Só para kind='day' — o offset em dias (30/60/90). */
  offsetDays?: number;
}

/** Janela (em dias) que caracteriza um marco "próximo" — destaque visual no cartão. */
export const UPCOMING_WINDOW_DAYS = 7;

function toDate(d: Date | string): Date {
  return typeof d === "string" ? parseISO(d) : d;
}

/** past = já ocorreu; upcoming = ocorre de hoje até +7d; future = futuro distante (>7d). */
function statusFor(daysUntil: number): MilestoneStatus {
  if (daysUntil < 0) return "past";
  if (daysUntil <= UPCOMING_WINDOW_DAYS) return "upcoming";
  return "future";
}

/**
 * Aniversário no ANO indicado, com CLAMP de 29/02 → 28/02 em ano não-bissexto (nunca "vaza" para
 * março). Escolha documentada: em ano comum, o aniversário de 29/02 é marcado em 28/02.
 */
function birthdayInYear(birthDate: string, year: number): Date {
  const bd = parseISO(birthDate);
  const month = bd.getMonth(); // 0-11
  const day = bd.getDate();
  const maxDay = getDaysInMonth(new Date(year, month, 1));
  return new Date(year, month, Math.min(day, maxDay));
}

/**
 * Marcos derivados de um paciente. Ordem de emissão: início, offsets (crescente) e aniversário.
 * - startDate nula ⇒ sem início e sem offsets (não há de onde derivar).
 * - birthDate nula ⇒ SIMPLESMENTE sem marco de aniversário (sem erro, sem placeholder).
 */
export function computeMilestones(input: {
  startDate: string | null;
  birthDate: string | null;
  today: Date | string;
  offsets?: readonly number[];
}): Milestone[] {
  const today = toDate(input.today);
  const offsets = input.offsets ?? JOURNEY_DAY_OFFSETS;
  const out: Milestone[] = [];

  if (input.startDate) {
    const start = parseISO(input.startDate);
    const startDays = differenceInCalendarDays(start, today);
    out.push({
      key: "start",
      kind: "start",
      label: "Início do acompanhamento",
      date: format(start, "yyyy-MM-dd"),
      daysUntil: startDays,
      status: statusFor(startDays),
    });

    for (const n of offsets) {
      const d = addDays(start, n);
      const daysUntil = differenceInCalendarDays(d, today);
      out.push({
        key: `day_${n}`,
        kind: "day",
        label: `${n} dias`,
        date: format(d, "yyyy-MM-dd"),
        daysUntil,
        status: statusFor(daysUntil),
        offsetDays: n,
      });
    }
  }

  if (input.birthDate) {
    const year = today.getFullYear();
    const bday = birthdayInYear(input.birthDate, year);
    const daysUntil = differenceInCalendarDays(bday, today);
    out.push({
      key: `birthday:${year}`,
      kind: "birthday",
      label: "Aniversário",
      date: format(bday, "yyyy-MM-dd"),
      daysUntil,
      status: statusFor(daysUntil),
    });
  }

  return out;
}

// Desempate por tipo quando dois marcos concorrem no mesmo grupo/dia (aniversário é o mais "humano").
const KIND_PRIORITY: Record<MilestoneKind, number> = { birthday: 0, start: 1, day: 2 };

/**
 * MARCO MAIS RELEVANTE para o selo do cartão: prioriza os "próximos" (upcoming, do mais cedo ao mais
 * tarde), depois os futuros (mais cedo primeiro), por fim os passados (mais recente primeiro).
 * Retorna null quando não há marcos (ex.: sem start_date e sem birth_date).
 */
export function pickRelevantMilestone(milestones: readonly Milestone[]): Milestone | null {
  if (milestones.length === 0) return null;
  const groupRank = (m: Milestone) => (m.status === "upcoming" ? 0 : m.status === "future" ? 1 : 2);
  const sorted = [...milestones].sort((a, b) => {
    const ga = groupRank(a);
    const gb = groupRank(b);
    if (ga !== gb) return ga - gb;
    if (a.status === "past") {
      // passados: o mais recente (daysUntil menos negativo = maior) primeiro.
      if (a.daysUntil !== b.daysUntil) return b.daysUntil - a.daysUntil;
    } else {
      // upcoming/future: o mais cedo (menor daysUntil) primeiro.
      if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
    }
    return KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
  });
  return sorted[0];
}
