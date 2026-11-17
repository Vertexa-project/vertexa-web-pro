import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { draftSeal, NO_REPLACE_NOTICE, type AiPlanDraft } from "@/lib/domain/planDraft";

/** Selo + "como foi montado" do rascunho da Vertexa IA, no topo do editor. */
export function AiDraftBanner({ draft, hasPublished }: { draft: AiPlanDraft; hasPublished: boolean }) {
  const p = draft.payload;
  return (
    <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm" data-testid="ai-draft-banner">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">
          <Sparkles className="mr-1 h-3 w-3" aria-hidden />
          {draftSeal(draft.mode)}
        </Badge>
        <span className="text-xs text-muted-foreground">Tipo: {draft.patient_type_label}</span>
      </div>
      {hasPublished ? <p role="note" className="text-xs font-medium text-primary-ink">{NO_REPLACE_NOTICE}</p> : null}
      {(p.warnings ?? []).length > 0 ? (
        <ul className="list-inside list-disc text-xs text-primary-ink" aria-label="Avisos do rascunho">
          {(p.warnings ?? []).map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      ) : null}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Como foi montado</summary>
        <ul className="mt-1 list-inside list-disc space-y-0.5">{(p.basis ?? []).map((b, i) => <li key={i}>{b}</li>)}</ul>
        {(p.guidance ?? []).length > 0 ? (
          <>
            <p className="mt-2 font-medium text-foreground">Orientações sugeridas (não vão para o paciente sozinhas)</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">{(p.guidance ?? []).map((g, i) => <li key={i}>{g}</li>)}</ul>
          </>
        ) : null}
      </details>
    </div>
  );
}
