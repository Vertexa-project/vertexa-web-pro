import { Cake, CheckCircle2, Flag, Timer } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { formatDate } from "@/lib/domain/format";
import type { Milestone } from "@/lib/domain/journeyMilestones";
import { cn } from "@/lib/utils";

const ICON = { start: Flag, birthday: Cake, day: Timer } as const;

function toneFor(milestone: Milestone, acked: boolean): NonNullable<BadgeProps["tone"]> {
  if (acked) return "muted";
  if (milestone.status === "upcoming") return "primary"; // destaque (próximos 7 dias)
  if (milestone.status === "future") return "info";
  return "muted"; // past
}

/**
 * Selo de um marco DERIVADO. Marco "próximo" (≤7d) recebe DESTAQUE (tom primário + anel). Marco
 * RECONHECIDO muda de aparência (tom neutro + check) — NÃO some. Mostra o rótulo e a data exata.
 */
export function MilestoneBadge({
  milestone,
  acked,
  className,
}: {
  milestone: Milestone;
  acked: boolean;
  className?: string;
}) {
  const Icon = acked ? CheckCircle2 : ICON[milestone.kind];
  const highlight = !acked && milestone.status === "upcoming";
  return (
    <Badge
      tone={toneFor(milestone, acked)}
      className={cn("gap-1", highlight && "ring-2 ring-primary/40", className)}
      title={`${milestone.label} · ${formatDate(milestone.date)}${acked ? " · reconhecido" : ""}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span>{milestone.label}</span>
      <span className="opacity-70">· {formatDate(milestone.date)}</span>
    </Badge>
  );
}
