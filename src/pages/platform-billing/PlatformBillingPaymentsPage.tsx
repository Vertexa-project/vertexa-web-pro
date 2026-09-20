import { useState } from "react";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { FilterField } from "@/components/platform-billing/FilterField";
import { LedgerList } from "@/components/platform-billing/LedgerList";
import { StatusChip } from "@/components/platform-billing/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import { usePlatformBillingPayments } from "@/hooks/usePlatformBilling";
import {
  billingMethodLabel,
  formatPlatformDate,
  formatPlatformMoney,
  paymentStateLabel,
  paymentStateTone,
  platformBillingErrorMessage,
} from "@/lib/domain/platformBilling";

export function PlatformBillingPaymentsPage() {
  const access = useAmIPlatformAdmin(true);
  const [state, setState] = useState("");
  const [method, setMethod] = useState("");
  const query = usePlatformBillingPayments(access.isPlatformAdmin === true, {
    displayState: state || undefined,
    method: method || undefined,
    limit: 50,
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Pagamentos</h2>
        <p className="text-sm text-muted-foreground">
          Histórico financeiro observado. Sem identificadores do provedor e sem payload.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <FilterField id="bp05-pay-state" label="Situação" value={state} onChange={setState}>
          <option value="">Todas</option>
          <option value="received">Recebido</option>
          <option value="pending">Pendente</option>
          <option value="overdue">Vencido</option>
        </FilterField>
        <FilterField id="bp05-pay-method" label="Meio" value={method} onChange={setMethod}>
          <option value="">Todos</option>
          <option value="PIX">Pix</option>
          <option value="BOLETO">Boleto</option>
          <option value="CREDIT_CARD">Cartão</option>
        </FilterField>
      </div>
      {query.isLoading ? <Skeleton className="h-64 w-full" /> : null}
      {query.isError ? (
        <ErrorState
          title="Não foi possível carregar os pagamentos"
          description={platformBillingErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {!query.isLoading && !query.isError && (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="Nenhum pagamento neste recorte" />
      ) : null}
      {(query.data?.items.length ?? 0) > 0 ? (
        <LedgerList
          columns={[
            {
              key: "clinic",
              header: "Clínica",
              render: (row) => row.clinicName ?? row.clinicId,
            },
            {
              key: "amount",
              header: "Valor",
              render: (row) => formatPlatformMoney(row.amountCents, row.currency),
            },
            {
              key: "due",
              header: "Vencimento",
              render: (row) => formatPlatformDate(row.dueDate),
            },
            {
              key: "received",
              header: "Recebido em",
              render: (row) => formatPlatformDate(row.receivedDate),
            },
            {
              key: "state",
              header: "Situação",
              render: (row) => (
                <StatusChip
                  label={paymentStateLabel(row.displayState)}
                  tone={paymentStateTone(row.displayState)}
                />
              ),
            },
            {
              key: "method",
              header: "Meio",
              render: (row) => billingMethodLabel(row.method),
            },
          ]}
          rows={query.data?.items ?? []}
          getRowId={(row) => row.id}
          ariaLabel="Pagamentos da plataforma"
          onRowHref={(row) => `/platform/billing/clinicas/${row.clinicId}`}
          mobile={(row) => (
            <div className="space-y-1">
              <p className="font-medium">{row.clinicName ?? "Clínica"}</p>
              <p className="text-sm">
                {formatPlatformMoney(row.amountCents)} · {paymentStateLabel(row.displayState)} ·{" "}
                {billingMethodLabel(row.method)}
              </p>
            </div>
          )}
          attention={(row) => row.displayState === "overdue"}
        />
      ) : null}
    </div>
  );
}
