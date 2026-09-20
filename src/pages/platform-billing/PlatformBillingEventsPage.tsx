import { useState } from "react";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { FilterField } from "@/components/platform-billing/FilterField";
import { LedgerList } from "@/components/platform-billing/LedgerList";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import { usePlatformBillingEvents } from "@/hooks/usePlatformBilling";
import {
  eventEntityLabel,
  eventTypeLabel,
  formatPlatformDate,
  platformBillingErrorMessage,
  processingStatusLabel,
} from "@/lib/domain/platformBilling";

export function PlatformBillingEventsPage() {
  const access = useAmIPlatformAdmin(true);
  const [status, setStatus] = useState("");
  const query = usePlatformBillingEvents(access.isPlatformAdmin === true, {
    processingStatus: status || undefined,
    limit: 50,
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Eventos</h2>
        <p className="text-sm text-muted-foreground">
          Metadados sanitizados do ledger. Sem JSON bruto, sem QR e sem identificador do provedor.
        </p>
      </div>
      <FilterField id="bp05-evt-status" label="Processamento" value={status} onChange={setStatus}>
        <option value="">Todos</option>
        <option value="received">Recebido</option>
        <option value="processed">Processado</option>
        <option value="failed">Falhou</option>
      </FilterField>
      {query.isLoading ? <Skeleton className="h-64 w-full" /> : null}
      {query.isError ? (
        <ErrorState
          title="Não foi possível carregar os eventos"
          description={platformBillingErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {!query.isLoading && !query.isError && (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="Nenhum evento neste recorte" />
      ) : null}
      {(query.data?.items.length ?? 0) > 0 ? (
        <LedgerList
          columns={[
            {
              key: "type",
              header: "Evento",
              render: (row) => eventTypeLabel(row.eventType),
            },
            {
              key: "clinic",
              header: "Clínica",
              render: (row) => row.clinicName ?? "Não correlacionado",
            },
            {
              key: "status",
              header: "Processamento",
              render: (row) => processingStatusLabel(row.processingStatus),
            },
            {
              key: "fail",
              header: "Falha",
              render: (row) => row.failureCategory ?? "—",
            },
            {
              key: "entity",
              header: "Entidade",
              render: (row) => eventEntityLabel(row.relatedEntityType),
            },
            {
              key: "when",
              header: "Recebido",
              render: (row) => formatPlatformDate(row.receivedAt),
            },
          ]}
          rows={query.data?.items ?? []}
          getRowId={(row) => row.id}
          ariaLabel="Eventos de faturamento"
          onRowHref={(row) =>
            row.clinicId ? `/platform/billing/clinicas/${row.clinicId}` : null
          }
          mobile={(row) => (
            <div className="space-y-1">
              <p className="font-medium">{eventTypeLabel(row.eventType)}</p>
              <p className="text-sm text-muted-foreground">
                {row.clinicName ?? "Não correlacionado"} ·{" "}
                {processingStatusLabel(row.processingStatus)}
                {row.failureCategory ? ` · ${row.failureCategory}` : ""}
              </p>
            </div>
          )}
          attention={(row) => row.processingStatus === "failed"}
        />
      ) : null}
    </div>
  );
}
