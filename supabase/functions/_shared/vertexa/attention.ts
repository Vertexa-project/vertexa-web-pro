// Cópia SERVIDOR da regra de atenção do painel (src/lib/domain/attention.ts + pendencies.ts).
// A paridade é provada por teste (vertexa.test.ts compara as duas implementações).
const DAY = 86_400_000;

export interface AttInput {
  status: string | null;
  rate: number | null;
  lastWeightAt: string | null;
  lastPhotoAt: string | null;
  lastWorkoutAt: string | null;
  lastActivityAt: string | null;
}
export type Level = "em_risco" | "atencao" | "ok";
export type ReasonKind = "adherence_drop" | "never_registered" | "no_record";
export interface Reason { kind: ReasonKind; label: string }

const t = (v: string | null) => (v ? new Date(v).getTime() : null);
const stale = (v: string | null, days: number, now: number) => (v ? now - new Date(v).getTime() > days * DAY : true);

export function classify(p: AttInput, now: number): { level: Level; reasons: Reason[]; hasPendency: boolean; since: number | null } {
  const pend =
    (stale(p.lastWeightAt, 7, now) ? 1 : 0) + (stale(p.lastPhotoAt, 30, now) ? 1 : 0) + (stale(p.lastWorkoutAt, 7, now) ? 1 : 0);
  const all = [p.lastWeightAt, p.lastPhotoAt, p.lastWorkoutAt, p.lastActivityAt].map(t).filter((x): x is number => x != null);
  const since = all.length ? Math.max(0, Math.floor((now - Math.max(...all)) / DAY)) : null;
  const reasons: Reason[] = [];
  let level: Level = p.status === "em_risco" ? "em_risco" : p.status === "atencao" ? "atencao" : "ok";
  if (p.status === "em_risco" || p.status === "atencao") {
    reasons.push({ kind: "adherence_drop", label: p.rate != null ? `Adesão caiu (${Math.round(p.rate)}% na semana)` : "Adesão caiu" });
  }
  if (since == null) reasons.push({ kind: "never_registered", label: "Ainda não registrou no app" });
  else if (pend > 0) reasons.push({ kind: "no_record", label: `Sem registro há ${since} ${since === 1 ? "dia" : "dias"}` });
  if (level === "ok" && reasons.length > 0) level = "atencao";
  return { level, reasons, hasPendency: pend > 0, since };
}

export const ACTION_LABEL: Record<ReasonKind, string> = {
  adherence_drop: "Preparar retorno",
  no_record: "Enviar lembrete",
  never_registered: "Chamar no app",
};
