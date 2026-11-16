import type { ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/domain/format";
import type { FocusAction } from "@/lib/domain/attention";

/**
 * Linha de paciente das listas do Dashboard (Foco do dia, Para reativar, Pendências).
 * Layout vertical dentro da coluna de texto: nome inteiro (quebra, nunca trunca), etiquetas
 * em linha própria (flex-wrap) e o botão numa terceira linha — nada se sobrepõe em 390 px.
 */
export function AttentionRow({
  name,
  badges,
  action,
  onAction,
}: {
  name: string;
  badges: ReactNode;
  action: FocusAction;
  onAction: (to: string) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Avatar className="shrink-0">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="break-words font-medium text-foreground">{name}</p>
        <div className="flex flex-wrap gap-1">{badges}</div>
        <Button
          variant="outline"
          size="sm"
          className="h-auto min-h-8 max-w-full shrink-0 whitespace-normal text-left"
          aria-label={`${action.label}: ${name}`}
          onClick={() => onAction(action.to)}
        >
          {action.label}
        </Button>
      </div>
    </div>
  );
}
