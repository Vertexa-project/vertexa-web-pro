// Recuperação muscular — regras puras (espelha o app paciente).
// PENDÊNCIA #1: o app usa neutral/activated; os combinados usam recovered/weakened.
// A web SÓ LÊ `muscle_recovery_states` e traduz para cor — não persiste status.
import type { MuscleStatus } from "@/types/db";
import type { BadgeTone } from "@/lib/domain/vri";

/** Status persistido → tom de cor (clinical-ui-states). */
export function muscleStatusTone(status: MuscleStatus): BadgeTone {
  switch (status) {
    case "fatigued":
      return "destructive"; // vermelho
    case "recovering":
      return "warning"; // amarelo
    case "recovered":
      return "info"; // azul
    case "weakened":
      return "success"; // verde (destreino)
    case "neutral":
      return "muted"; // cinza
  }
}

/** Rótulo pt-BR para o status muscular. */
export function muscleStatusLabel(status: MuscleStatus): string {
  const labels: Record<MuscleStatus, string> = {
    fatigued: "Fadigado",
    recovering: "Em recuperação",
    recovered: "Recuperado",
    weakened: "Enfraquecido",
    neutral: "Neutro",
  };
  return labels[status];
}
