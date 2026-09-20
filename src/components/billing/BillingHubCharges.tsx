import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useClinicBillingCharges } from "@/hooks/useBillingHub";
import { formatBillingPriceCents } from "@/lib/domain/billingCheckout";
import {
  OVERDUE_REGULARIZE_COPY,
  billingHubErrorMessage,
  billingMethodLabel,
  chargeStateLabel,
  chargeStateTone,
  formatBillingCivilDate,
  type ClinicBillingCharge,
} from "@/lib/domain/billingHub";

export function BillingHubCharges({ clinicId }: { clinicId: string }) {
  const query = useClinicBillingCharges(clinicId, true);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cobranças</CardTitle>
        <CardDescription>
          Histórico derivado do ledger da clínica. A Vertexa não cria cobrança avulsa aqui.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span role="status">Carregando cobranças…</span>
          </p>
        ) : null}
        {query.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {billingHubErrorMessage(query.error)}
          </p>
        ) : null}
        {!query.isLoading && !query.isError && (query.data?.length ?? 0) === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            Ainda não há cobrança registrada para esta clínica.
          </p>
        ) : null}
        {query.data && query.data.length > 0 ? (
          <ChargeList items={query.data} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function ChargeList({ items }: { items: ClinicBillingCharge[] }) {
  const hasOverdue = items.some((item) => item.displayState === "OVERDUE");
  return (
    <div className="space-y-3">
      {hasOverdue ? (
        <p className="text-sm text-destructive" role="status">
          {OVERDUE_REGULARIZE_COPY}
        </p>
      ) : null}
      <ul className="divide-y rounded-lg border">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-medium">
                {formatBillingPriceCents(item.amountCents, item.currency)}
              </p>
              <p className="text-sm text-muted-foreground">
                Vencimento {formatBillingCivilDate(item.dueDate)}
                {item.paidDate ? ` · pago em ${formatBillingCivilDate(item.paidDate)}` : ""}
                {` · ${billingMethodLabel(item.method)}`}
              </p>
            </div>
            <Badge tone={chargeStateTone(item.displayState)}>{chargeStateLabel(item.displayState)}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
