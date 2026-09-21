import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useClinicBillingOverview } from "@/hooks/useBillingHub";
import {
  billingCycleLabel,
  formatBillingPriceCents,
  type ClinicCommercialCheckout,
} from "@/lib/domain/billingCheckout";
import {
  billingHubErrorMessage,
  financialSituationCopy,
  nextChargeCopy,
  paymentStateLabel,
  pixHubLabel,
  providerEnvironmentLabel,
  resolveHubFourStates,
} from "@/lib/domain/billingHub";
import { pixProductLabel } from "@/lib/domain/billingPixCheckout";

export function BillingHubOverview({
  clinicId,
  checkout,
}: {
  clinicId: string;
  checkout: ClinicCommercialCheckout;
}) {
  const overview = useClinicBillingOverview(clinicId, true);
  const contract = checkout.commercialContract;

  if (overview.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
          <span role="status">Carregando o resumo financeiro da clínica…</span>
        </CardContent>
      </Card>
    );
  }

  if (overview.isError) {
    return (
      <Card>
        <CardContent className="p-6">
          <p role="alert" className="text-sm text-destructive">
            {billingHubErrorMessage(overview.error)}
          </p>
        </CardContent>
      </Card>
    );
  }

  const data = overview.data;
  const four = data ? resolveHubFourStates(data) : null;
  const planName = data?.plan?.displayName ?? contract?.planDisplayName ?? null;
  const planPrice = data?.plan?.priceCents ?? contract?.priceCents ?? null;
  const situation = data?.financialSituation;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Situação da assinatura</CardTitle>
        <CardDescription>
          Contrato, Pix, cobrança e liberação do produto são fatos separados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact
            label="Plano atual"
            value={
              planName && planPrice != null
                ? `${planName} · ${formatBillingPriceCents(planPrice)}/mês`
                : "Nenhum plano contratado"
            }
            hint={contract ? billingCycleLabel(contract.billingCycle) : undefined}
          />
          <Fact
            label="Pix Automático"
            value={`${pixHubLabel(data?.pixAuthorizationStatus ?? checkout.pixAuthorizationStatus)}${
              data?.environment ? ` · ${providerEnvironmentLabel(data.environment) ?? data.environment}` : ""
            }`}
          />
          <Fact
            label="Próxima cobrança"
            value={`${nextChargeCopy(data?.nextCharge ?? null)}${
              data?.nextCharge?.environment
                ? ` · ${providerEnvironmentLabel(data.nextCharge.environment) ?? data.nextCharge.environment}`
                : data?.environment
                  ? ` · ${providerEnvironmentLabel(data.environment) ?? data.environment}`
                  : ""
            }`}
            empty={!data?.nextCharge}
          />
          <Fact
            label="Situação financeira"
            value={situation ? financialSituationCopy(situation) : "Sem informação financeira"}
            attention={situation?.attention === true}
          />
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <StateRow label="Contrato comercial" value={four?.commercialContractStatus ?? "—"} />
          <StateRow
            label="Pix Automático"
            value={pixProductLabel(four?.pixAuthorizationStatus ?? checkout.pixAuthorizationStatus)}
          />
          <StateRow
            label="Pagamento"
            value={
              four?.financialPaymentStatus
                ? paymentStateLabel(four.financialPaymentStatus)
                : "ainda não há pagamento registrado"
            }
          />
          <StateRow label="Liberação do produto" value="desligada" />
        </div>
      </CardContent>
    </Card>
  );
}

function Fact({
  label,
  value,
  hint,
  empty,
  attention,
}: {
  label: string;
  value: string;
  hint?: string;
  empty?: boolean;
  attention?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        {attention ? <Badge tone="destructive">Atenção</Badge> : null}
      </div>
      <p className={empty ? "mt-1 text-sm text-muted-foreground" : "mt-1 text-sm font-medium leading-snug"}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function StateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}
