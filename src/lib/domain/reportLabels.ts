// Rótulos pt-BR para enums que chegam CRUS do banco/RPC e aparecem em PDFs e telas.
// Reaproveita os mapas já existentes (agenda, documentKind, activityEvents, muscleRecovery);
// aqui só o que não tinha dono. Valor desconhecido NUNCA vaza em inglês: cai em "—"/"Outro".
import { activityEventMeta } from "@/lib/domain/activityEvents";
import { TYPE_META, STATUS_META } from "@/lib/domain/agenda";
import { DOCUMENT_KIND_LABELS } from "@/lib/domain/documentKind";
import { muscleGroupLabel, muscleStatusLabel } from "@/lib/domain/muscleRecovery";
import type { AppointmentStatus, AppointmentType, MuscleStatus, PatientDocumentKind } from "@/types/db";

const own = <T extends object>(o: T, k: string): k is Extract<keyof T, string> => Object.prototype.hasOwnProperty.call(o, k);

/** weight_logs.source: 'app' (paciente) | 'web' (profissional) | 'assessment' (avaliação). */
export function weightSourceLabel(source: string | null | undefined): string {
  switch (source) {
    case "app":
      return "App do paciente";
    case "web":
      return "Profissional";
    case "assessment":
      return "Avaliação";
    default:
      return "—";
  }
}

export function appointmentTypeLabel(t: string | null | undefined): string {
  return t && own(TYPE_META, t) ? TYPE_META[t as AppointmentType].label : "Outros";
}

export function appointmentStatusLabel(s: string | null | undefined): string {
  return s && own(STATUS_META, s) ? STATUS_META[s as AppointmentStatus].label : "—";
}

export function documentKindLabel(k: string | null | undefined): string {
  return k && own(DOCUMENT_KIND_LABELS, k) ? DOCUMENT_KIND_LABELS[k as PatientDocumentKind] : "Outro";
}

const MUSCLE_STATUSES = ["fatigued", "recovering", "recovered", "weakened", "neutral"];
export function muscleStatusLabelSafe(s: string | null | undefined): string {
  return s && MUSCLE_STATUSES.includes(s) ? muscleStatusLabel(s as MuscleStatus) : "—";
}

/** Grupo muscular: chave conhecida → rótulo; desconhecida → "—" (nunca o código em inglês). */
export function muscleGroupLabelSafe(key: string | null | undefined): string {
  if (!key) return "—";
  const label = muscleGroupLabel(key);
  return label === key ? "—" : label;
}

export function activityTypeLabel(type: string | null | undefined): string {
  return activityEventMeta(type ?? "").label;
}
