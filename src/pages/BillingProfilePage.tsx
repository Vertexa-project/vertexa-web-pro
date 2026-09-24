import { useMemo, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { useParams } from "react-router-dom";

import { BillingCommercialUsagePanel } from "@/components/billing/BillingCommercialUsagePanel";
import { BillingHubCharges } from "@/components/billing/BillingHubCharges";
import { BillingHubOverview } from "@/components/billing/BillingHubOverview";
import { BillingHubPayments } from "@/components/billing/BillingHubPayments";
import { BillingHubTimeline } from "@/components/billing/BillingHubTimeline";
import { BillingIdentityForm } from "@/components/billing/BillingIdentityForm";
import { BillingPixCheckoutPanel } from "@/components/billing/BillingPixCheckoutPanel";
import { BillingHostedCardCheckoutPanel } from "@/components/billing/BillingHostedCardCheckoutPanel";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useClinicCommercialCheckout,
  useCreateClinicCommercialContract,
  useSellableBillingPlans,
} from "@/hooks/useBillingCheckout";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import {
  billingCheckoutErrorMessage,
  billingCycleLabel,
  checkoutWizardStep,
  formatBillingPriceCents,
  isActiveCommercialContract,
  isExpectedBillingCheckoutError,
  type SellableBillingPlan,
} from "@/lib/domain/billingCheckout";
import { captureException } from "@/lib/observability/sentry";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "plan", label: "Plano" },
  { id: "identity", label: "Cobrança" },
  { id: "review", label: "Revisão" },
] as const;

export function BillingProfilePage() {
  const { checkoutReturn } = useParams<{ checkoutReturn?: "success" | "cancel" | "expired" }>();
  const { data: me } = useCurrentProfessional();
  const clinicId = me?.clinicId ?? null;
  const { isClinicAdmin, isLoading: adminLoading } = useIsClinicAdmin(clinicId);
  const checkout = useClinicCommercialCheckout(clinicId, isClinicAdmin);
  const catalog = useSellableBillingPlans(isClinicAdmin);
  const createContract = useCreateClinicCommercialContract(clinicId);
  const [draftPlanVersionId, setDraftPlanVersionId] = useState<string | null>(null);
  const [selectedPlanVersionId, setSelectedPlanVersionId] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const activeContract = isActiveCommercialContract(checkout.data?.commercialContract ?? null);
  const selectedPlan = useMemo(
    () => catalog.data?.find((plan) => plan.planVersionId === selectedPlanVersionId) ?? null,
    [catalog.data, selectedPlanVersionId],
  );
  const step = checkoutWizardStep({
    hasActiveContract: activeContract,
    identityComplete: checkout.data?.identityComplete === true,
    selectedPlanVersionId,
  });

  if (adminLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Assinatura e faturamento" />
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
            Verificando suas permissões…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isClinicAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Assinatura e faturamento" />
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            Apenas o administrador da clínica gerencia os dados de faturamento.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (checkout.isLoading || catalog.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Assinatura e faturamento" description="Contrate o plano da clínica e registre os dados de cobrança." />
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
            Carregando o catálogo e o estado comercial…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (checkout.isError || catalog.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Assinatura e faturamento" />
        <Card>
          <CardContent className="p-6">
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar a contratação. Tente novamente em instantes.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (activeContract && checkout.data?.commercialContract) {
    const contract = checkout.data.commercialContract;
    return (
      <div className="space-y-6">
        <PageHeader
          title="Assinatura e faturamento"
          description="Acompanhe o plano, o Pix Automático e as cobranças da clínica."
        />
        {clinicId ? <BillingHubOverview clinicId={clinicId} checkout={checkout.data} /> : null}
        {clinicId ? <BillingCommercialUsagePanel clinicId={clinicId} /> : null}
        {clinicId ? <BillingHubCharges clinicId={clinicId} /> : null}
        {clinicId ? <BillingHubPayments clinicId={clinicId} /> : null}
        {clinicId ? <BillingHubTimeline clinicId={clinicId} /> : null}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cartão de crédito</CardTitle>
            <CardDescription>
              Checkout hospedado para o plano {contract.planDisplayName}. O contrato comercial {contract.status}{" "}
              não é confirmação de pagamento nem de acesso liberado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {clinicId ? <BillingHostedCardCheckoutPanel clinicId={clinicId} returnState={checkoutReturn} /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pix Automático</CardTitle>
            <CardDescription>
              Autorização bancária do plano {contract.planDisplayName}. Contrato comercial {contract.status}{" "}
              não significa pagamento recebido nem acesso liberado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {clinicId ? <BillingPixCheckoutPanel clinicId={clinicId} checkout={checkout.data} /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados de cobrança</CardTitle>
            <CardDescription>Usados na cobrança da assinatura da clínica. Não são nota fiscal.</CardDescription>
          </CardHeader>
          <CardContent>
            {clinicId ? <BillingIdentityForm clinicId={clinicId} /> : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assinatura e faturamento"
        description="Escolha o plano, confirme os dados de cobrança e registre o contrato comercial."
      />

      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Etapas da contratação">
        {STEPS.map((item, index) => {
          const current = item.id === step;
          return (
            <li
              key={item.id}
              className={cn(
                "rounded-full border px-3 py-1",
                current ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground",
              )}
            >
              {index + 1}. {item.label}
            </li>
          );
        })}
      </ol>

      {step === "plan" ? (
        <PlanStep
          plans={catalog.data ?? []}
          selectedPlanVersionId={draftPlanVersionId}
          onSelect={setDraftPlanVersionId}
          onContinue={() => setSelectedPlanVersionId(draftPlanVersionId)}
        />
      ) : null}

      {step === "identity" && clinicId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados de cobrança</CardTitle>
            <CardDescription>
              Razão social, CPF/CNPJ e e-mail usados na cobrança da assinatura. Não é emissão de nota fiscal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedPlan ? <SelectedPlanHint plan={selectedPlan} /> : null}
            <Button type="button" variant="outline" onClick={() => setSelectedPlanVersionId(null)}>
              Voltar
            </Button>
            <BillingIdentityForm
              clinicId={clinicId}
              onComplete={() => checkout.refetch()}
            />
          </CardContent>
        </Card>
      ) : null}

      {step === "review" && selectedPlan ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revisão da contratação</CardTitle>
            <CardDescription>
              O preço vem do catálogo no servidor. Confirmar cria só o contrato comercial — sem Pix e sem QR.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SelectedPlanHint plan={selectedPlan} />
            <p className="text-sm text-muted-foreground">
              Depois desta confirmação, a próxima etapa será configurar o Pix Automático. Isso ainda não acontece agora.
            </p>
            {confirmError ? (
              <p role="alert" className="text-sm text-destructive">
                {confirmError}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setSelectedPlanVersionId(null)}>
              Voltar
            </Button>
            <Button
              disabled={createContract.isPending}
              onClick={() => {
                setConfirmError(null);
                createContract.mutate(selectedPlan.planVersionId, {
                  onError: (err) => {
                    setConfirmError(billingCheckoutErrorMessage(err));
                    if (!isExpectedBillingCheckoutError(err)) {
                      captureException(err, { source: "billing", scope: "commercial-checkout" });
                    }
                  },
                });
              }}
            >
              {createContract.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Confirmando…
                </>
              ) : (
                "Confirmar contratação"
              )}
            </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function PlanStep({
  plans,
  selectedPlanVersionId,
  onSelect,
  onContinue,
}: {
  plans: SellableBillingPlan[];
  selectedPlanVersionId: string | null;
  onSelect: (planVersionId: string) => void;
  onContinue: () => void;
}) {
  if (plans.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <p role="status" className="text-sm text-muted-foreground">
            Nenhum plano disponível para contratação agora.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => {
          const selected = plan.planVersionId === selectedPlanVersionId;
          return (
            <button
              key={plan.planVersionId}
              type="button"
              onClick={() => onSelect(plan.planVersionId)}
              className={cn(
                "rounded-xl border bg-card p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "border-primary ring-1 ring-primary" : "hover:border-primary/40",
              )}
              aria-pressed={selected}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-xl font-semibold">{plan.displayName}</p>
                  {plan.tagline ? <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p> : null}
                </div>
                {selected ? <Badge tone="primary">Selecionado</Badge> : null}
              </div>
              <p className="mt-4 font-display text-2xl font-semibold">
                {formatBillingPriceCents(plan.priceCents, plan.currency)}
                <span className="ml-1 text-sm font-normal text-muted-foreground">/mês</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{billingCycleLabel(plan.billingCycle)}</p>
              <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                {plan.features.slice(0, 5).map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>
      <Button disabled={!selectedPlanVersionId} onClick={onContinue}>
        Continuar
      </Button>
      <p className="text-sm text-muted-foreground">
        O preço exibido vem do catálogo no servidor. Nenhum identificador interno é usado na contratação.
      </p>
    </div>
  );
}

function SelectedPlanHint({ plan }: { plan: SellableBillingPlan }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3">
      <p className="text-sm font-medium">{plan.displayName}</p>
      <p className="text-sm text-muted-foreground">
        {formatBillingPriceCents(plan.priceCents, plan.currency)} · {billingCycleLabel(plan.billingCycle)}
      </p>
    </div>
  );
}
