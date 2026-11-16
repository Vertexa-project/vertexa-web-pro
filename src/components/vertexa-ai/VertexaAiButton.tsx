import { useContext } from "react";
import { Sparkles } from "lucide-react";

import { VertexaAiContext } from "./vertexa-ai-context";
import { cn } from "@/lib/utils";

/** Abre o painel da Vertexa IA. Sem provider (telas fora do AppShell) não aparece. */
export function VertexaAiButton({ variant }: { variant: "menu" | "topbar" }) {
  const ctx = useContext(VertexaAiContext);
  if (!ctx) return null;
  const open = () => ctx.setOpen(true);
  if (variant === "menu") {
    return (
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        className="group relative flex w-full items-center gap-3 rounded-[10px] bg-foreground px-[11px] py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Sparkles className="h-[18px] w-[18px] shrink-0 text-brand" aria-hidden />
        <span>Vertexa IA</span>
        <kbd className="ml-auto rounded bg-background/15 px-1.5 text-[10px] font-medium">⌘K</kbd>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      aria-haspopup="dialog"
      aria-label="Abrir a Vertexa IA"
      title="Vertexa IA (⌘K)"
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Sparkles className="h-4 w-4 text-brand" aria-hidden />
      <span className="hidden sm:inline">Vertexa IA</span>
    </button>
  );
}
