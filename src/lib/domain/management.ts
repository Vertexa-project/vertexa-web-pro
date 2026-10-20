// Tipos e regras PURAS da tela Gestão (espelham public.clinic_management_overview / transfer_patients).
export interface ProfessionalLoad {
  professional_id: string;
  name: string;
  clinic_role: string | null;
  patients: number;
  em_risco: number;
  atencao: number;
  avg_adherence: number | null;
  idle: number;
}
export interface StoppedPatient { patient_id: string; name: string | null; idle_days: number; professionals: string[] }
export interface ManagementOverview {
  idle_days: number;
  patients: number;
  unassigned: number;
  professionals: ProfessionalLoad[];
  new_by_month: Array<{ month: string; n: number }>;
  stopped: StoppedPatient[];
}
export interface RosterPatient { patient_id: string; full_name: string | null; idle_days: number }

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "2026-10" → "out/26". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] ?? ym}/${(y ?? "").slice(2)}`;
}

/** Percentual do paciente da equipe em relação ao total atribuído (para a barra de carga). */
export function loadShare(patients: number, max: number): number {
  return max <= 0 ? 0 : Math.round((patients / max) * 100);
}

export function maxLoad(list: ProfessionalLoad[]): number {
  return list.reduce((m, p) => Math.max(m, p.patients), 0);
}

export function idleLabel(days: number): string {
  return days === 1 ? "1 dia" : `${days} dias`;
}

export type TransferCheck = { ok: true } | { ok: false; error: string };
export function validateTransfer(fromId: string | null, toId: string | null, selected: number): TransferCheck {
  if (!fromId) return { ok: false, error: "Escolha o profissional de origem." };
  if (!toId) return { ok: false, error: "Escolha o profissional de destino." };
  if (fromId === toId) return { ok: false, error: "Origem e destino precisam ser diferentes." };
  if (selected < 1) return { ok: false, error: "Selecione ao menos um paciente." };
  return { ok: true };
}

export function transferSummary(moved: number, skipped: number): string {
  const base = moved === 1 ? "1 paciente transferido." : `${moved} pacientes transferidos.`;
  return skipped > 0 ? `${base} ${skipped} ignorado${skipped > 1 ? "s" : ""} (já não eram deste profissional).` : base;
}
