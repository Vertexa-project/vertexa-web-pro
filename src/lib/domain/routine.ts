// Rotina por paciente (A4) e missão da 1ª semana (A5) — tipos e textos PUROS. A conta de quem cumpriu o quê é feita no banco
// (get_patient_routine / get_patient_mission), em America/Sao_Paulo, sobre os registros reais (fotos e peso).

export type RoutinePeriod = "off" | "weekly" | "monthly";
export type RoutineItemKey = "photo" | "weight" | "feedback";
export type MissionStepKey = "photo_front" | "photo_side" | "photo_back" | "weight" | "supplements_photo" | "bio";

export interface MissionStepConfig { key: MissionStepKey; label: string; enabled: boolean; allow_skip: boolean }

export interface ClinicRoutineSettings {
  clinic_id: string;
  routine_enabled: boolean;
  photo_period: RoutinePeriod; photo_weekday: number;
  weight_period: RoutinePeriod; weight_weekday: number;
  feedback_period: RoutinePeriod; feedback_weekday: number;
  mission_enabled: boolean;
  mission_days: number;
  mission_steps: MissionStepConfig[];
}

/** O que vale quando a clínica ainda não salvou nada: tudo DESLIGADO, com o padrão da Juliana pronto para ligar. */
export const DEFAULT_MISSION_STEPS: MissionStepConfig[] = [
  { key: "photo_front", label: "Foto de frente", enabled: true, allow_skip: false },
  { key: "photo_side", label: "Foto de lado", enabled: true, allow_skip: false },
  { key: "photo_back", label: "Foto de costas", enabled: true, allow_skip: false },
  { key: "weight", label: "Peso na balança, em jejum", enabled: true, allow_skip: false },
  { key: "supplements_photo", label: "Foto dos suplementos que você usa", enabled: true, allow_skip: true },
  { key: "bio", label: "Bioimpedância (se você tiver)", enabled: true, allow_skip: true },
];

export const DEFAULT_ROUTINE_SETTINGS: Omit<ClinicRoutineSettings, "clinic_id"> = {
  routine_enabled: false,
  photo_period: "monthly", photo_weekday: 5,
  weight_period: "monthly", weight_weekday: 5,
  feedback_period: "weekly", feedback_weekday: 5,
  mission_enabled: false, mission_days: 7, mission_steps: DEFAULT_MISSION_STEPS,
};

export const ROUTINE_ITEMS: Array<{ key: RoutineItemKey; label: string; hint: string }> = [
  { key: "photo", label: "Foto de evolução", hint: "o paciente envia uma foto" },
  { key: "weight", label: "Peso na balança, em jejum", hint: "o paciente registra o peso" },
  { key: "feedback", label: "Feedback da semana", hint: "o paciente conta como foi" },
];

export const PERIOD_OPTIONS: Array<{ value: RoutinePeriod; label: string }> = [
  { value: "off", label: "Não pedir" },
  { value: "weekly", label: "Toda semana" },
  { value: "monthly", label: "Todo mês (1ª ocorrência do dia)" },
];

export const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const WEEKDAY_SHORT = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function periodText(period: RoutinePeriod, weekday: number): string {
  const d = WEEKDAY_SHORT[weekday] ?? "sexta";
  if (period === "off") return "não pedido";
  return period === "weekly" ? `toda ${d}` : `1ª ${d} do mês`;
}

export interface RoutineOccurrence { date: string; state: "done" | "due_today" | "overdue" | "missed"; done_on: string | null }
export interface RoutineItemView { key: RoutineItemKey; label: string; period: RoutinePeriod; weekday: number; occurrences: RoutineOccurrence[] }
export interface RoutineCurrent { key: RoutineItemKey; label: string; due_on: string; state: "due_today" | "overdue" }
export interface RoutineView {
  enabled: boolean;
  source: "clinic_off" | "patient_off" | "clinic" | "custom";
  items: RoutineItemView[];
  current: RoutineCurrent[];
  last_feedback?: { note: string; at: string } | null;
}

export interface MissionStepView { key: MissionStepKey; label: string; allow_skip: boolean; done: boolean; done_on: string | null }
export interface MissionView {
  enabled: boolean;
  started: boolean;
  days?: number;
  started_on?: string;
  ends_on?: string;
  overdue?: boolean;
  steps?: MissionStepView[];
  done_count?: number;
  total?: number;
  completed?: boolean;
  completed_on?: string | null;
  celebrated?: boolean;
}

export const SOURCE_LABEL: Record<RoutineView["source"], string> = {
  clinic: "Padrão da clínica",
  custom: "Personalizada para este paciente",
  patient_off: "Desligada para este paciente",
  clinic_off: "Desligada na clínica",
};

/** "2026-11-17" → "17/11". */
export function dayMonth(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}` : "—";
}

export const STATE_LABEL: Record<RoutineOccurrence["state"], string> = {
  done: "feito", due_today: "para hoje", overdue: "pendente", missed: "não feito",
};

/** Resumo de uma linha das ocorrências cumpridas, ex.: "3 de 4 feitas". */
export function doneOfTotal(item: RoutineItemView): { done: number; total: number } {
  return { done: item.occurrences.filter((o) => o.state === "done").length, total: item.occurrences.length };
}
