// Metadados de exibição dos activity_events (escritos pelo app paciente).
import {
  Activity,
  Camera,
  Droplet,
  Gauge,
  Dumbbell,
  Moon,
  Scale,
  Utensils,
  type LucideIcon,
} from "lucide-react";

import type { BadgeTone } from "@/lib/domain/vri";

export interface ActivityMeta {
  label: string;
  icon: LucideIcon;
  tone: BadgeTone;
}

export function activityEventMeta(type: string): ActivityMeta {
  switch (type) {
    case "workout_checked":
      return { label: "Treino concluído", icon: Dumbbell, tone: "success" };
    case "weight_logged":
      return { label: "Peso registrado", icon: Scale, tone: "info" };
    case "progress_photo_uploaded":
      return { label: "Foto de progresso", icon: Camera, tone: "primary" };
    case "hydration_logged":
      return { label: "Hidratação", icon: Droplet, tone: "info" };
    case "sleep_logged":
      return { label: "Sono registrado", icon: Moon, tone: "info" };
    case "workout_effort":
      return { label: "Esforço do treino", icon: Gauge, tone: "info" };
    case "meal_plan_viewed":
      return { label: "Plano alimentar visto", icon: Utensils, tone: "muted" };
    default:
      return { label: type.replace(/_/g, " "), icon: Activity, tone: "muted" };
  }
}

export function activityEventDescription(
  type: string,
  payload: Record<string, unknown> | null,
): string | null {
  if (!payload) return null;
  switch (type) {
    case "workout_checked":
      return typeof payload.workout === "string" ? payload.workout : null;
    case "workout_effort": {
      const e = Number(payload.effort);
      return Number.isInteger(e) && e >= 1 && e <= 10 ? `${e} de 10` : null;
    }
    case "weight_logged":
      return payload.weight != null ? `${payload.weight} kg` : null;
    case "hydration_logged": {
      // Chave canônica = `liters`; tolera o alias legado `amount` (ver CONTRATO_INTEGRACAO).
      const liters = payload.liters ?? payload.amount;
      return liters != null ? `${liters} L` : null;
    }
    default:
      return null;
  }
}
