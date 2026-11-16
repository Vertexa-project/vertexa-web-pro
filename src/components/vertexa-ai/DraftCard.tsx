import { useState } from "react";
import { Check, FileText, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { DraftAction, DraftView } from "@/lib/domain/vertexaAi";
import { draftUseLabel } from "@/lib/domain/vertexaAi";
import { cn } from "@/lib/utils";

const STATUS_TEXT: Record<DraftView["status"], string> = {
  rascunho: "Rascunho · nada foi salvo",
  em_revisao: "Em revisão · nada foi salvo",
  usado: "Entregue a você · nada foi salvo pela IA",
  descartado: "Descartado · nada foi salvo",
};

/**
 * CartaoRascunho: todo resultado da IA vem aqui, como RASCUNHO. Revisar / Usar / Descartar.
 * "Usar" entrega o texto (campo de resposta ou área de transferência); quem salva ou envia é o profissional.
 * Cada campo traz a fonte; dado incerto vai em laranja.
 */
export function DraftCard({
  view,
  onAction,
}: {
  view: DraftView;
  onAction: (action: DraftAction, editedText?: string) => void;
}) {
  const { draft, status } = view;
  const [text, setText] = useState(view.text);
  const closed = status === "usado" || status === "descartado";

  return (
    <div className={cn("mt-2 rounded-lg border bg-card p-3 text-sm", status === "descartado" ? "opacity-60" : "border-warning/50")}>
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 break-words font-semibold text-foreground">{draft.title}</p>
        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-primary-ink">
          {STATUS_TEXT[status]}
        </span>
      </div>

      {draft.fields.length > 0 && draft.kind !== "mensagem" ? (
        <dl className="mt-2 space-y-1.5">
          {draft.fields.map((f) => (
            <div key={`${f.label}:${f.value}`} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="break-words">
                <span className={cn("font-medium", f.uncertain ? "text-primary-ink" : "text-foreground")}>
                  {f.value}
                </span>
                {f.uncertain ? <span className="ml-1 text-xs text-primary-ink">· conferir</span> : null}
                <span className="ml-1 text-xs text-muted-foreground">fonte: {f.source}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {draft.kind === "mensagem" ? (
        status === "em_revisao" ? (
          <Textarea className="mt-2 min-h-24" value={text} onChange={(e) => setText(e.target.value)} aria-label="Texto do rascunho" />
        ) : (
          <p className="mt-2 whitespace-pre-line break-words rounded-md bg-muted p-2 text-foreground">“{view.text}”</p>
        )
      ) : null}

      {!closed ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {status === "rascunho" ? (
            <Button size="sm" variant="outline" onClick={() => onAction("revisar")}>
              Revisar
            </Button>
          ) : null}
          <Button size="sm" onClick={() => onAction("usar", status === "em_revisao" ? text : undefined)}>
            <Check className="h-4 w-4" aria-hidden />
            {draftUseLabel(draft)}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onAction("descartar")}>
            <Trash2 className="h-4 w-4" aria-hidden />
            Descartar
          </Button>
        </div>
      ) : null}
    </div>
  );
}
