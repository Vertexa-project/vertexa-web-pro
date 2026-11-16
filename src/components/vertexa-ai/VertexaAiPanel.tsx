import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Send, Sparkles } from "lucide-react";

import { DraftCard } from "./DraftCard";
import { ScreenSuggestions } from "./ScreenSuggestions";
import { useVertexaAi } from "./vertexa-ai-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { QUICK_ACTIONS, type ChatMessage } from "@/lib/domain/vertexaAi";
import { cn } from "@/lib/utils";

function Bubble({ m }: { m: ChatMessage }) {
  const { actOnDraft, setOpen } = useVertexaAi();
  const navigate = useNavigate();
  const mine = m.role === "user";
  return (
    <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[92%] break-words rounded-xl px-3 py-2 text-sm",
          mine ? "bg-primary-ink text-primary-foreground" : m.error ? "bg-warning/15 text-warning-foreground dark:text-warning" : "bg-muted text-foreground",
        )}
      >
        <p className="whitespace-pre-line">{m.text}</p>
        {m.reply && m.reply.items.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {m.reply.items.map((it) => (
              <li key={`${it.text}:${it.source}`} className="break-words">
                <span className={cn(it.uncertain && "font-medium text-warning-foreground dark:text-warning")}>{it.text}</span>
                {it.uncertain ? <span className="ml-1 text-xs text-warning-foreground dark:text-warning">· conferir</span> : null}
                <span className="ml-1 text-xs text-muted-foreground">fonte: {it.source}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {m.draft ? <DraftCard view={m.draft} onAction={(a, t) => actOnDraft(m.id, a, t)} /> : null}
        {m.reply && m.reply.actions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {m.reply.actions.map((a) => (
              <Button
                key={a.to + a.label}
                size="sm"
                variant="outline"
                className="h-auto min-h-8 max-w-full whitespace-normal text-left"
                onClick={() => {
                  setOpen(false);
                  navigate(a.to);
                }}
              >
                {a.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <span className="mt-0.5 px-1 text-[11px] text-muted-foreground">
        {mine ? `Em: ${m.context}` : m.mode === "demo" ? "Modo demonstração" : null}
      </span>
    </div>
  );
}

/** Painel lateral da Vertexa IA (Sheet; em 390 px ocupa a tela). */
export function VertexaAiPanel({ intro }: { intro: string }) {
  const { open, setOpen, screen, contextText, messages, pending, ask, mode } = useVertexaAi();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, pending, open]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || pending) return;
    setText("");
    void ask(t);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full max-w-full gap-0 p-0 sm:max-w-md">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 pr-12">
          <Sparkles className="h-5 w-5 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0">
            <SheetTitle className="text-base">Vertexa IA</SheetTitle>
            <SheetDescription>Sua assistente</SheetDescription>
          </div>
          {mode === "demo" ? (
            <Badge tone="warning" className="ml-auto whitespace-normal">
              Modo demonstração
            </Badge>
          ) : null}
        </div>

        <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground" data-testid="vertexa-ai-context">
          Vendo: <b className="break-words text-foreground">{contextText}</b>
        </div>

        <div className="relative min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-4 py-3" aria-live="polite">
          <div className="max-w-[92%] break-words rounded-xl bg-muted px-3 py-2 text-sm text-foreground">{intro}</div>
          {messages.map((m) => (
            <Bubble key={m.id} m={m} />
          ))}
          {pending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Montando o rascunho…
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <div className="space-y-2 border-t border-border px-4 py-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ações rápidas">
            {QUICK_ACTIONS.map((a) => (
              <Button key={a.label} size="sm" variant="outline" disabled={pending} onClick={() => void ask(a.prompt)}>
                {a.label}
              </Button>
            ))}
          </div>
          <ScreenSuggestions screen={screen} disabled={pending} onPick={(s) => void ask(s)} />
          <form onSubmit={submit} className="flex gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Peça algo à Vertexa IA"
              maxLength={600}
              aria-label="Peça algo à Vertexa IA"
              autoComplete="off"
            />
            <Button type="submit" disabled={pending || !text.trim()} aria-label="Enviar">
              <Send className="h-4 w-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">Enviar</span>
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">A Vertexa IA organiza o que está registrado. Você decide e confirma. Ela não marca pagamento nem movimenta caixa.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
