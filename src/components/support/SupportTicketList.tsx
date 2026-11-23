import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

import { SupportStatusBadge } from "@/components/support/SupportStatusBadge";
import { SUPPORT_CATEGORY_LABEL, type SupportSide, type SupportTicketRow } from "@/lib/api/support";
import { formatSupportDateTime } from "@/lib/help/supportFormat";
import { cn } from "@/lib/utils";

export function SupportTicketList({
  tickets,
  side,
  basePath,
}: {
  tickets: SupportTicketRow[];
  side: SupportSide;
  basePath: string;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {tickets.map((t) => (
        <li key={t.id}>
          <Link
            to={`${basePath}/${t.id}`}
            className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
          >
            <span
              className={cn("h-2 w-2 shrink-0 rounded-full", t.unread ? "bg-primary" : "bg-transparent")}
              aria-label={t.unread ? "Novidade não lida" : undefined}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn("break-words", t.unread ? "font-semibold" : "font-medium")}>{t.subject}</span>
                <SupportStatusBadge status={t.status} side={side} />
              </span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                nº {t.number} · {SUPPORT_CATEGORY_LABEL[t.category]}
                {side === "vertexa" ? ` · ${t.clinicName}` : ""}
                {t.openedByName ? ` · ${t.openedByName}` : ""} · {formatSupportDateTime(t.lastMessageAt)}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
