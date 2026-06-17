// Formatação pt-BR compartilhada (date-fns).
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

function toDate(value: string | Date): Date {
  return typeof value === "string" ? parseISO(value) : value;
}

/** Ex.: "17 de jun. de 2026". */
export function formatDate(value: string | Date): string {
  return format(toDate(value), "dd 'de' MMM 'de' yyyy", { locale: ptBR });
}

/** Ex.: "há 2 dias". */
export function formatRelative(value: string | Date): string {
  return formatDistanceToNow(toDate(value), { addSuffix: true, locale: ptBR });
}

/** Ex.: "68,4 kg". */
export function formatWeight(kg: number | null | undefined): string {
  if (kg == null) return "—";
  return `${kg.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;
}

/** Ex.: "80%". */
export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value)}%`;
}

/** Saudação dinâmica pelo horário. */
export function greeting(hour: number): string {
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}
