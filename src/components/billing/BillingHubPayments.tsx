import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useClinicBillingPayments } from "@/hooks/useBillingHub";
import { formatBillingPriceCents } from "@/lib/domain/billingCheckout";
import {
  billingHubErrorMessage,
  billingMethodLabel,
  formatBillingCivilDate,
  paymentStateLabel,
  paymentStateTone,
  type ClinicBillingPayment,
} from "@/lib/domain/billingHub";

export function BillingHubPayments({ clinicId }: { clinicId: string }) {
  const query = useClinicBillingPayments(clinicId, true);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pagamentos</CardTitle>
        <CardDescription>Valores recebidos ou em aberto da assinatura da clínica.</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span role="status">Carregando pagamentos…</span>
          </p>
        ) : null}
        {query.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {billingHubErrorMessage(query.error)}
          </p>
        ) : null}
        {!query.isLoading && !query.isError && (query.data?.length ?? 0) === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            Ainda não há pagamento registrado.
          </p>
        ) : null}
        {query.data && query.data.length > 0 ? <PaymentList items={query.data} /> : null}
      </CardContent>
    </Card>
  );
}

function PaymentList({ items }: { items: ClinicBillingPayment[] }) {
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="font-medium">{formatBillingPriceCents(item.amountCents, item.currency)}</p>
            <p className="text-sm text-muted-foreground">
              {item.receivedDate
                ? `Recebido em ${formatBillingCivilDate(item.receivedDate)}`
                : `Vencimento ${formatBillingCivilDate(item.dueDate)}`}
              {` · ${billingMethodLabel(item.method)}`}
            </p>
          </div>
          <Badge tone={paymentStateTone(item.displayState)}>{paymentStateLabel(item.displayState)}</Badge>
        </li>
      ))}
    </ul>
  );
}
