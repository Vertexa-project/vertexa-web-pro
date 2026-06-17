// VRI (Índice de Retenção) — regras puras de status/cor.
// Fonte: skill clinical-ui-states. NÃO recalcular o VRI na web (PENDÊNCIA #3):
// ler `adherence_snapshots`; estas funções só derivam nível/cor para exibição.
import type { PatientStatus } from "@/types/db";

export type VriLevel = "alta" | "moderada" | "baixa" | "risco" | "inativo";

// Tom semântico do badge — mapeia para os tokens de status do design.
export type BadgeTone = "success" | "warning" | "primary" | "destructive" | "muted" | "info";

/** Faixas de score → nível (clinical-ui-states). */
export function vriLevelFromScore(score: number): VriLevel {
  if (score >= 80) return "alta";
  if (score >= 50) return "moderada";
  if (score >= 20) return "baixa";
  return "risco";
}

/** Nível → tom de cor do badge. */
export function vriToneFromLevel(level: VriLevel): BadgeTone {
  switch (level) {
    case "alta":
      return "success"; // verde
    case "moderada":
      return "warning"; // amarelo
    case "baixa":
      return "primary"; // laranja (acento)
    case "risco":
      return "destructive"; // vermelho
    case "inativo":
      return "muted"; // cinza
  }
}

/** patient_status (banco) → tom de cor do badge. */
export function statusToTone(status: PatientStatus): BadgeTone {
  switch (status) {
    case "em_acompanhamento":
      return "success";
    case "atencao":
      return "warning";
    case "em_risco":
      return "destructive";
    case "inativo":
      return "muted";
    case "novo":
      return "info";
  }
}

/** Rótulo pt-BR para o nível do VRI. */
export function vriLevelLabel(level: VriLevel): string {
  const labels: Record<VriLevel, string> = {
    alta: "Adesão alta",
    moderada: "Adesão moderada",
    baixa: "Adesão baixa",
    risco: "Em risco",
    inativo: "Inativo",
  };
  return labels[level];
}

/** Rótulo pt-BR para o patient_status do banco. */
export function statusLabel(status: PatientStatus): string {
  const labels: Record<PatientStatus, string> = {
    novo: "Novo",
    em_acompanhamento: "Em acompanhamento",
    atencao: "Atenção",
    em_risco: "Em risco",
    inativo: "Inativo",
  };
  return labels[status];
}
