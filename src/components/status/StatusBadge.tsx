import { Badge } from "@/components/ui/badge";
import type { PatientStatus } from "@/types/db";
import {
  statusLabel,
  statusToTone,
  vriLevelFromScore,
  vriLevelLabel,
  vriToneFromLevel,
} from "@/lib/domain/vri";

interface StatusBadgeProps {
  /** Quando há patient_status persistido (preferencial). */
  status?: PatientStatus | null;
  /** Fallback: deriva nível/cor a partir do score do snapshot. */
  score?: number | null;
}

/**
 * Badge de status do paciente por VRI.
 * Usa o patient_status quando presente; senão deriva do score.
 */
export function StatusBadge({ status, score }: StatusBadgeProps) {
  if (status) {
    return <Badge tone={statusToTone(status)}>{statusLabel(status)}</Badge>;
  }
  if (typeof score === "number") {
    const level = vriLevelFromScore(score);
    return <Badge tone={vriToneFromLevel(level)}>{vriLevelLabel(level)}</Badge>;
  }
  return <Badge tone="muted">Sem dados</Badge>;
}
