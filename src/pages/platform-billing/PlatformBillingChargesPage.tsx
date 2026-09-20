import { useState } from "react";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { FilterField } from "@/components/platform-billing/FilterField";
import { LedgerList } from "@/components/platform-billing/LedgerList";
import { StatusChip } from "@/components/platform-billing/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import { usePlatformBillingCharges } from "@/hooks/usePlatformBilling";
import {
  billingMethodLabel,
  chargeStateLabel,
  chargeStateTone,
  formatPlatformDate,
  formatPlatformMoney,
  platformBillingErrorMessage,
} from "@/lib/domain/platformBilling";

export function PlatformBillingChargesPage() {
  const access = useAmIPlatformAdmin(true);
  const [state, setState] = useState("");
  const [method, setMethod] = useState("");
  const query = usePlatformBillingCharges(access.isPlatformAdmin === true, {
    displayState: state || undefined,
    method: method || undefined,
    limit: 50,
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Cobranças</h2>
        <p className="text-sm text-muted-foreground">
          Cobrança e pagamento são fatos separados. A Vertexa não cria outra cobrança daqui.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <FilterField id="bp05-charge-state" label="Situação" value={state} onChange={setState}>
          <option value="">Todas</option>
          <option value="OVERDUE">Vencida</option>
          <option value="PENDING">Pendente</option>
          <option value="PROGRAMMED">Programada</option>
          <option value="PAID">Paga</option>
        </FilterField>
        <FilterField id="bp05-charge-method" label="Meio" value={method} onChange={setMethod}>
          <option value="">Todos</option>
          <option value="PIX">Pix</option>
          <option value="BOLETO">Boleto</option>
          <option value="CREDIT_CARD">Cartão</option>
        </FilterField>
      </div>
      {query.isLoading ? <Skeleton className="h-64 w-full" /> : null}
      {query.isError ? (
        <ErrorState
          title="Não foi possível carregar as cobranças"
          description={platformBillingErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {!query.isLoading && !query.isError && (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="Nenhuma cobrança neste recorte" />
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
              key: "paid",
              header: "Pago em",
              render: (row) => formatPlatformDate(row.paidDate),
            },
            {
              key: "state",
              header: "Situação",
              render: (row) => (
                <StatusChip
                  label={chargeStateLabel(row.displayState)}
                  tone={chargeStateTone(row.displayState)}
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
          ariaLabel="Cobranças da plataforma"
          onRowHref={(row) => `/platform/billing/clinicas/${row.clinicId}`}
          mobile={(row) => (
            <div className="space-y-1">
              <p className="font-medium">{row.clinicName ?? "Clínica"}</p>
              <p className="text-sm">
                {formatPlatformMoney(row.amountCents)} · {chargeStateLabel(row.displayState)} ·{" "}
                {billingMethodLabel(row.method)}
              </p>
              <p className="text-xs text-muted-foreground">
                Vencimento {formatPlatformDate(row.dueDate)}
              </p>
            </div>
          )}
          attention={(row) => row.displayState === "OVERDUE"}
        />
      ) : null}
    </div>
  );
}
