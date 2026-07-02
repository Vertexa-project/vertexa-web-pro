// Formatação pt-BR compartilhada (date-fns).
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

import type { ProfessionalType } from "@/types/db";

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

/** Ex.: "2,5 L". */
export function formatLiters(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} L`;
}

/** Ex.: "80%". */
export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value)}%`;
}

/** Tamanho de arquivo legível. Ex.: "1,2 MB" / "840 KB" / "512 B". */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} KB`;
  const mb = kb / 1024;
  return `${mb.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** Saudação dinâmica pelo horário. */
export function greeting(hour: number): string {
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

/** Nome curto para saudação: mantém título (Dr./Dra.) + primeiro nome. Ex.: "Dra. Camila". */
export function shortName(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (/^dr/i.test(parts[0]) && parts[1]) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}

/** Iniciais a partir de um nome (até 2 letras). */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** Rótulo pt-BR do tipo de profissional. */
export function professionalTypeLabel(type: ProfessionalType): string {
  const labels: Record<ProfessionalType, string> = {
    doctor: "Médico(a)",
    nutritionist: "Nutricionista",
    physiotherapist: "Fisioterapeuta",
    personal_trainer: "Personal trainer",
    other: "Profissional",
  };
  return labels[type];
}
