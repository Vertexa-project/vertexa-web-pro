// Sinais de RISCO do paciente — regras PURAS e read-only, derivadas do que a web já lê.
// Complementam o VRI (NÃO o duplicam): apontam pontos concretos para o profissional olhar no
// retorno. Nada é persistido; nada é recalculado no VRI. NUNCA fabricamos dado: uma fonte que
// não existe (mobilidade) é marcada como `available:false` ("sem dados"), não inventada.
//
// THRESHOLDS (parametrizáveis; DEFAULTS pendentes de validação clínica com a Juliana — ver
// docs/PENDENCIAS.md):
//  - Sobrecarga muscular: músculo ainda `fatigued` (vermelho) ALÉM da janela normal de fadiga.
//    O app deriva recuperação por dias desde o treino (recoveryRule: 0–2d = fatigued é NORMAL
//    pós-treino). Só sinalizamos quando o músculo segue `fatigued` há ≥ `muscleFatiguedMinDays`
//    (i.e., além do esperado); ≥ `muscleFatiguedHighDays` = severidade alta.
//    ⚠️ A web lê o `status` PERSISTIDO de muscle_recovery_states (mesma fonte da aba Recuperação),
//    que NÃO decai server-side (PENDÊNCIA #1) → um `fatigued` pode estar "preso". Por isso o texto
//    fala em "ainda sinalizado em fadiga" e a sobrecarga CRÔNICA real (recorrência/carga acumulada)
//    depende de histórico de sessões de treino, que ainda não existe.
//  - Meta de água: NÃO há meta por paciente no banco → usamos um DEFAULT (`waterGoalLiters`).
//    Janela = últimos `waterWindowDays` dias COMPLETOS (exclui hoje parcial). Contamos "abaixo da
//    meta" APENAS em dias COM registro (ausência de log ≠ "não bebeu" — não assumimos).
//  - Foto ausente: reusa a política de pendências (30d). > `photoMissingHighDays` = alta.
//  - Mobilidade: sem fonte (o app não registra) → sempre `available:false`.
import { muscleGroupLabel } from "@/lib/domain/muscleRecovery";
import { PENDENCY_THRESHOLDS } from "@/lib/domain/pendencies";
import type { MuscleRecoveryState } from "@/types/db";

const DAY = 1000 * 60 * 60 * 24;

export const RISK_THRESHOLDS = {
  muscleFatiguedMinDays: 3, // além da janela normal de fadiga (0–2d)
  muscleFatiguedHighDays: 5,
  waterGoalLiters: 2.0, // DEFAULT — não há meta por paciente (validar clínica)
  waterWindowDays: 7,
  photoMissingDays: PENDENCY_THRESHOLDS.photoDays, // 30 (espelha as pendências)
  photoMissingHighDays: 60,
} as const;

export type RiskSignalKind = "muscle_overload" | "hydration" | "photo_missing" | "mobility";
export type RiskSeverity = "info" | "warn" | "high";

export interface RiskSignal {
  kind: RiskSignalKind;
  title: string;
  severity: RiskSeverity;
  /** Há um risco a mostrar agora. */
  active: boolean;
  /** A fonte de dados existe. `false` = "sem dados" honesto (ex.: mobilidade). */
  available: boolean;
  /** ISO — desde quando o sinal vale (ex.: última foto / músculo no vermelho). */
  since?: string;
  detail: string;
}

export interface DailyLiters {
  date: string;
  liters: number;
}

export interface RiskSignalsInput {
  muscles: MuscleRecoveryState[];
  hydrationDaily: DailyLiters[]; // últimos N dias completos (getHydrationDailyLiters)
  lastPhotoAt: string | null;
  now?: number;
}

const fmtL = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function muscleSignal(muscles: MuscleRecoveryState[], now: number): RiskSignal {
  const base = { kind: "muscle_overload" as const, title: "Sobrecarga muscular", available: true };
  const sustained = muscles
    .filter((m) => m.status === "fatigued" && m.last_trained_at)
    .map((m) => ({ m, days: Math.floor((now - new Date(m.last_trained_at as string).getTime()) / DAY) }))
    .filter((x) => x.days >= RISK_THRESHOLDS.muscleFatiguedMinDays)
    .sort((a, b) => b.days - a.days);

  if (sustained.length === 0) {
    return {
      ...base,
      active: false,
      severity: "info",
      detail:
        muscles.length === 0
          ? "Sem grupos monitorados (nenhum treino registrado no app)."
          : "Nenhum músculo em fadiga além da janela normal de recuperação.",
    };
  }
  const worst = sustained[0];
  const names = sustained.map((x) => `${muscleGroupLabel(x.m.muscle_group)} (${x.days}d)`).join(", ");
  return {
    ...base,
    active: true,
    severity: worst.days >= RISK_THRESHOLDS.muscleFatiguedHighDays ? "high" : "warn",
    since: worst.m.last_trained_at ?? undefined,
    detail: `${sustained.length} grupo(s) ainda sinalizado(s) em fadiga além do normal: ${names}. Avaliar recuperação.`,
  };
}

function hydrationSignal(daily: DailyLiters[]): RiskSignal {
  const base = { kind: "hydration" as const, title: "Meta de água", available: true };
  const goal = RISK_THRESHOLDS.waterGoalLiters;
  const total = daily.length;
  if (total === 0) {
    return { ...base, active: false, severity: "info", detail: "Sem janela de dados de hidratação." };
  }
  const logged = daily.filter((d) => d.liters > 0);
  // Tolerância a erro de ponto flutuante ao somar registros do dia (ex.: incrementos de "copos"):
  // um dia que soma nominalmente a meta não deve ser contado como "abaixo" por um epsilon.
  const EPS = 1e-9;
  const belowLogged = logged.filter((d) => d.liters < goal - EPS).length;
  const noLog = total - logged.length;

  // Nunca registrou nada na janela → engajamento/hidratação a verificar (não assumimos desidratação).
  if (logged.length === 0) {
    return { ...base, active: true, severity: "warn", detail: `Sem registros de água nos últimos ${total} dias.` };
  }
  // Dias COM registro abaixo da meta → sinal real de meta não batida.
  if (belowLogged > 0) {
    const metLogged = logged.length - belowLogged;
    const suffix = noLog > 0 ? ` (+${noLog} dia(s) sem registro)` : "";
    return {
      ...base,
      active: true,
      severity: metLogged === 0 ? "high" : "warn",
      detail: `Abaixo da meta (${fmtL(goal)} L/dia) em ${belowLogged} de ${logged.length} dias com registro${suffix}.`,
    };
  }
  // Todos os dias registrados bateram a meta.
  const suffix = noLog > 0 ? `; ${noLog} dia(s) sem registro na janela.` : ".";
  return {
    ...base,
    active: false,
    severity: "info",
    detail: `Meta (${fmtL(goal)} L/dia) batida em todos os dias com registro${suffix}`,
  };
}

function photoSignal(lastPhotoAt: string | null, now: number): RiskSignal {
  const base = { kind: "photo_missing" as const, title: "Foto de progresso", available: true };
  const elapsed = lastPhotoAt ? now - new Date(lastPhotoAt).getTime() : null;
  const days = elapsed != null ? Math.floor(elapsed / DAY) : null; // só para o texto
  // Mesma semântica de pendencies.isStaleSince: "passou de N dias" (elapsed > N*DAY), SEM floor —
  // para o painel e o card de Pendências concordarem exatamente no limite (30/60 dias).
  const missing = elapsed == null || elapsed > RISK_THRESHOLDS.photoMissingDays * DAY;
  if (!missing) {
    return { ...base, active: false, severity: "info", detail: `Última foto há ${days} dia(s).` };
  }
  const high = elapsed != null && elapsed > RISK_THRESHOLDS.photoMissingHighDays * DAY;
  return {
    ...base,
    active: true,
    severity: high ? "high" : "warn",
    since: lastPhotoAt ?? undefined,
    detail:
      days == null
        ? "Nenhuma foto de progresso enviada."
        : `Sem foto de progresso há ${days} dias (meta: a cada ${RISK_THRESHOLDS.photoMissingDays}).`,
  };
}

// Mobilidade: o app NÃO registra mobilidade/aquecimento (é conteúdo estático, não logado) e não há
// tipo de activity_event nem tabela. Marcamos como indisponível — HONESTO, nunca fabricado.
function mobilitySignal(): RiskSignal {
  return {
    kind: "mobility",
    title: "Mobilidade",
    available: false,
    active: false,
    severity: "info",
    detail: "Sem fonte de dados — o app ainda não registra mobilidade/aquecimento.",
  };
}

/** Ordem estável (mais severo primeiro entre os ativos ajuda a UI, mas mantemos ordem fixa). */
export function computeRiskSignals(input: RiskSignalsInput): RiskSignal[] {
  const now = input.now ?? Date.now();
  return [
    muscleSignal(input.muscles, now),
    hydrationSignal(input.hydrationDaily),
    photoSignal(input.lastPhotoAt, now),
    mobilitySignal(),
  ];
}

const SEVERITY_RANK: Record<RiskSeverity, number> = { high: 0, warn: 1, info: 2 };
/** Ordena por severidade (alta → baixa). Útil para listar os ativos. */
export function bySeverity(a: RiskSignal, b: RiskSignal): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
}
