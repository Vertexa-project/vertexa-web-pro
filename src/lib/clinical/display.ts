import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

import type { EncounterPeople } from "@/lib/api/clinical";

export function formatDateTimeBr(iso: string): string {
  return format(parseISO(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

const TYPE_LABEL: Record<string, string> = {
  nutritionist: "Nutricionista",
  physio: "Fisioterapeuta",
  trainer: "Educador físico",
  doctor: "Médico(a)",
  other: "",
};

/** Seção "Profissional" (preenchida pelo sistema, não pela IA). */
export function professionalSectionValues(
  people: EncounterPeople | null | undefined,
  startedAt: string,
): Array<{ label: string; value: string }> {
  const council = [people?.type ? TYPE_LABEL[people.type] ?? "" : "", people?.registry ?? ""].filter(Boolean).join(" · ");
  return [
    { label: "Nome", value: people?.professional ?? "—" },
    { label: "Conselho e número", value: council || "Não informado no cadastro" },
    { label: "Data e hora do atendimento", value: formatDateTimeBr(startedAt) },
  ];
}
