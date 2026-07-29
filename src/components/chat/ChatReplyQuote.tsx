import { CornerUpLeft } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ResolvedQuote } from "@/lib/domain/chatReply";

interface ChatReplyQuoteProps {
  quote: ResolvedQuote;
  className?: string;
}

/**
 * Citação da mensagem respondida (WP-CHAT-B item 3). SÓ EXIBIÇÃO.
 *
 * DEGRADAÇÃO EXPLÍCITA: quando a citada não foi resolvida (`found=false`), a citação continua
 * aparecendo — em itálico e sem autor — dizendo "Mensagem original indisponível". A alternativa
 * (sumir com o bloco) faria a resposta parecer uma mensagem solta; a outra (quebrar) não é
 * alternativa nenhuma. A lista renderiza sempre.
 */
export function ChatReplyQuote({ quote, className }: ChatReplyQuoteProps) {
  return (
    <div
      className={cn(
        "flex gap-2 rounded-md border-l-2 border-primary/50 bg-background/60 px-2 py-1.5 text-xs",
        className,
      )}
    >
      <CornerUpLeft className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        {quote.author ? (
          <p className="truncate font-medium text-foreground">{quote.author}</p>
        ) : null}
        <p className={cn("line-clamp-2 text-muted-foreground", !quote.found && "italic")}>
          {quote.preview}
        </p>
      </div>
    </div>
  );
}
