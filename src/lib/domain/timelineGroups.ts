// Agrupa os "hábitos" (água, refeição, humor, sono, suplemento) por DIA (America/Sao_Paulo) num único
// item da linha do tempo; os demais eventos seguem um a um. Puro.
import { formatNumber } from "@/lib/domain/format";
import type { ActivityEvent } from "@/types/db";

export const HABIT_TYPES = ["hydration_logged", "meal_logged", "mood_logged", "sleep_logged", "supplement_checked"] as const;
const HABIT_SET = new Set<string>(HABIT_TYPES);

export interface HabitDay {
  kind: "habits";
  /** aaaa-mm-dd em America/Sao_Paulo. */
  day: string;
  /** Registro mais recente do dia (ISO). */
  latestAt: string;
  summary: string;
}
export interface SingleEvent {
  kind: "event";
  event: ActivityEvent;
}
export type TimelineItem = HabitDay | SingleEvent;

export function saoPauloDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summarize(events: ActivityEvent[]): string {
  const by = (t: string) => events.filter((e) => e.type === t);
  const parts: string[] = [];
  const water = by("hydration_logged");
  if (water.length > 0) {
    const liters = water.reduce((s, e) => {
      const v = Number(e.payload?.liters ?? e.payload?.amount);
      return Number.isFinite(v) ? s + v : s;
    }, 0);
    const n = plural(water.length, "registro", "registros");
    parts.push(liters > 0 ? `Água ${formatNumber(Math.round(liters * 100) / 100, 2)} L em ${n}` : `Água: ${n} sem quantidade`);
  }
  const meals = by("meal_logged");
  if (meals.length > 0) parts.push(`Refeições: ${plural(meals.length, "registrada", "registradas")}`);
  const mood = by("mood_logged");
  if (mood.length > 0) parts.push(`Humor: ${plural(mood.length, "registro", "registros")}`);
  const sleep = by("sleep_logged");
  if (sleep.length > 0) parts.push("Sono registrado");
  const supp = by("supplement_checked");
  if (supp.length > 0) parts.push(`Suplementos: ${plural(supp.length, "tomado", "tomados")}`);
  return parts.join(" · ");
}

/** Recebe os eventos (qualquer ordem, normalmente mais recente primeiro) e devolve a lista de itens. */
export function groupTimeline(events: ActivityEvent[]): TimelineItem[] {
  const sorted = [...events].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const groups = new Map<string, ActivityEvent[]>();
  const out: Array<TimelineItem | { placeholder: string }> = [];
  for (const ev of sorted) {
    if (HABIT_SET.has(ev.type)) {
      const day = saoPauloDay(ev.created_at);
      const g = groups.get(day);
      if (g) g.push(ev);
      else {
        groups.set(day, [ev]);
        out.push({ placeholder: day });
      }
    } else {
      out.push({ kind: "event", event: ev });
    }
  }
  return out.map((o) => {
    if ("placeholder" in o) {
      const g = groups.get(o.placeholder) as ActivityEvent[];
      return { kind: "habits", day: o.placeholder, latestAt: g[0].created_at, summary: summarize(g) } as HabitDay;
    }
    return o;
  });
}
