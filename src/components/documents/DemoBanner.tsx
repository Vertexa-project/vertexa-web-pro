import { AlertTriangle } from "lucide-react";

import { DEMO_NOTICE } from "@/lib/domain/clinicalDocs";

/** Faixa do modo demonstração: sempre visível, nunca escondida. */
export function DemoBanner() {
  return (
    <p role="note" data-testid="doc-demo-banner" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/15 px-3 py-2 text-sm font-medium text-warning-foreground">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span className="min-w-0 break-words">{DEMO_NOTICE}</span>
    </p>
  );
}
