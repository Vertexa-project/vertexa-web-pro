// Atenção do paciente — UMA regra para KPIs do Dashboard, "Foco do dia" e "Para reativar".
// Entradas: snapshot VRI (quando existe) + recência de registros (pendências). Puro, sem I/O.
import { computePendencies } from "@/lib/domain/pendencies";
import type { PatientListItem } from "@/types/db";

const DAY = 1000 * 60 * 60 * 24;

export type AttentionLevel = "em_risco" | "atencao" | "ok";
export type AttentionReasonKind = "adherence_drop" | "never_registered" | "no_record";

export interface AttentionReason {
  kind: AttentionReasonKind;
  /** Etiqueta pt-BR exibida. NUNCA "Sem dados". */
  label: string;
}

export interface PatientAttention {
  level: AttentionLevel;
  reasons: AttentionReason[];
  primary: AttentionReason | null;
  hasPendency: boolean;
}

type AttentionInput = Pick<PatientListItem, "snapshot" | "lastActivityAt" | "lastWeightAt" | "lastPhotoAt" | "lastWorkoutAt">;

const ts = (v: string | null) => (v ? new Date(v).getTime() : null);

/** Dias desde o registro mais recente de qualquer tipo; null se nunca registrou nada. */
export function daysSinceLastRecord(p: AttentionInput, now: number): number | null {
  const all = [p.lastWeightAt, p.lastPhotoAt, p.lastWorkoutAt, p.lastActivityAt].map(ts).filter((x): x is number => x != null);
  if (all.length === 0) return null;
  return Math.max(0, Math.floor((now - Math.max(...all)) / DAY));
}

export function dayWord(n: number): string {
  return `${n} ${n === 1 ? "dia" : "dias"}`;
}

export function classifyPatient(p: AttentionInput, now: number = Date.now()): PatientAttention {
  const reasons: AttentionReason[] = [];
  const status = p.snapshot?.status ?? null;
  const rate = p.snapshot?.weekly_completion_rate;
  const pend = computePendencies({ lastWeightAt: p.lastWeightAt, lastPhotoAt: p.lastPhotoAt, lastWorkoutAt: p.lastWorkoutAt }, now);
  const since = daysSinceLastRecord(p, now);

  let level: AttentionLevel = "ok";
  if (status === "em_risco") level = "em_risco";
  else if (status === "atencao") level = "atencao";

  if (status === "em_risco" || status === "atencao") {
    reasons.push({ kind: "adherence_drop", label: rate != null ? `Adesão caiu (${Math.round(rate)}% na semana)` : "Adesão caiu" });
  }
  if (since == null) {
    reasons.push({ kind: "never_registered", label: "Ainda não registrou no app" });
  } else if (pend.count > 0) {
    reasons.push({ kind: "no_record", label: `Sem registro há ${dayWord(since)}` });
  }
  if (level === "ok" && reasons.length > 0) level = "atencao";

  return { level, reasons, primary: reasons[0] ?? null, hasPendency: pend.count > 0 };
}

const RANK: Record<AttentionLevel, number> = { em_risco: 0, atencao: 1, ok: 2 };

/** Ordem do "Foco do dia": risco > atenção; depois mais motivos; depois menor score. */
export function focusOrder<T extends AttentionInput>(list: T[], now: number = Date.now()): Array<{ patient: T; attention: PatientAttention }> {
  return list
    .map((patient) => ({ patient, attention: classifyPatient(patient, now) }))
    .filter((x) => x.attention.level !== "ok")
    .sort(
      (a, b) =>
        RANK[a.attention.level] - RANK[b.attention.level] ||
        b.attention.reasons.length - a.attention.reasons.length ||
        (a.patient.snapshot?.score ?? 0) - (b.patient.snapshot?.score ?? 0),
    );
}

export interface DashboardKpis {
  emRisco: number;
  atencao: number;
  pendencias: number;
}

/** KPIs do Dashboard — contam pela MESMA classificação usada nas listas. */
export function attentionKpis(list: AttentionInput[], now: number = Date.now()): DashboardKpis {
  let emRisco = 0;
  let atencao = 0;
  let pendencias = 0;
  for (const p of list) {
    const a = classifyPatient(p, now);
    if (a.level === "em_risco") emRisco += 1;
    else if (a.level === "atencao") atencao += 1;
    if (a.hasPendency) pendencias += 1;
  }
  return { emRisco, atencao, pendencias };
}

export type FocusAction = { label: string; to: string };

/** Ação específica por motivo. Não há reenvio de convite no produto: paciente sem registro vai para Mensagens. */
export function focusAction(patientId: string, reason: AttentionReason | null): FocusAction {
  switch (reason?.kind) {
    case "adherence_drop":
      return { label: "Preparar retorno", to: `/pacientes/${patientId}` };
    case "no_record":
      return { label: "Enviar lembrete", to: `/mensagens?patient=${patientId}` };
    case "never_registered":
      return { label: "Chamar no app", to: `/mensagens?patient=${patientId}` };
    default:
      return { label: "Abrir ficha", to: `/pacientes/${patientId}` };
  }
}
