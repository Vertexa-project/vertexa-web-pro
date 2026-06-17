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

/** Rótulo pt-BR para o grupo muscular (chaves vindas do app paciente). */
export function muscleGroupLabel(key: string): string {
  const labels: Record<string, string> = {
    chest: "Peito",
    biceps: "Bíceps",
    triceps: "Tríceps",
    lats: "Dorsais",
    shoulders: "Ombros",
    abs: "Abdômen",
    forearms: "Antebraços",
    quadriceps: "Quadríceps",
    hamstrings: "Posteriores",
    glutes: "Glúteos",
    calves: "Panturrilhas",
    traps: "Trapézio",
    lower_back: "Lombar",
  };
  return labels[key.toLowerCase()] ?? key;
}
