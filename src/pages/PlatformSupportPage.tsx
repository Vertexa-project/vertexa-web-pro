import { useState } from "react";

import { LoadingState } from "@/components/feedback/LoadingState";
import { SupportTicketList } from "@/components/support/SupportTicketList";
import { usePlatformSupportCounts, usePlatformSupportTickets } from "@/hooks/useSupport";
import type { SupportStatus } from "@/lib/api/support";
import { cn } from "@/lib/utils";

const FILTERS: { value: SupportStatus | null; label: string; countKey?: "aberto" | "respondido" | "resolvido" }[] = [
  { value: "aberto", label: "Aguardando resposta", countKey: "aberto" },
  { value: "respondido", label: "Aguardando a clínica", countKey: "respondido" },
  { value: "resolvido", label: "Resolvidos", countKey: "resolvido" },
  { value: null, label: "Todos" },
];

/** Plataforma › Suporte: chamados de todas as clínicas (cartão 1317 · entrega 2). */
export function PlatformSupportPage() {
  const [status, setStatus] = useState<SupportStatus | null>("aberto");
  const tickets = usePlatformSupportTickets(status);
  const counts = usePlatformSupportCounts();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Suporte</h1>
        <p className="text-sm text-muted-foreground">Chamados abertos pelas clínicas na Central de Ajuda.</p>
      </div>
      <div role="tablist" aria-label="Filtrar chamados" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = f.value === status;
          const n = f.countKey ? counts.data?.[f.countKey] : undefined;
          return (
            <button
              key={f.label}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStatus(f.value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
              {typeof n === "number" ? ` (${n})` : ""}
            </button>
          );
        })}
      </div>
      {tickets.isLoading ? (
        <LoadingState />
      ) : tickets.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar os chamados.</p>
      ) : (tickets.data ?? []).length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum chamado aqui.
        </p>
      ) : (
        <SupportTicketList tickets={tickets.data ?? []} side="vertexa" basePath="/platform/suporte" />
      )}
    </div>
  );
}
