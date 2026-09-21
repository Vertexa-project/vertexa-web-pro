import { Link, useParams } from "react-router-dom";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { StatusChip } from "@/components/platform-billing/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import { usePlatformClinicBillingDetail } from "@/hooks/usePlatformBilling";
import {
  attentionReasonLabel,
  billingMethodLabel,
  chargeStateLabel,
  chargeStateTone,
  clinicPlanCopy,
  contractStatusLabel,
  customerBoundLabel,
  eventTypeLabel,
  financialSummaryLabel,
  financialSummaryTone,
  formatPlatformDate,
  formatPlatformMoney,
  identityLabel,
  nextChargeCopy,
  paymentStateLabel,
  paymentStateTone,
  pixAutomaticStatusLabel,
  platformBillingErrorMessage,
  processingStatusLabel,
  providerEnvironmentLabel,
  timelineEventLabel,
} from "@/lib/domain/platformBilling";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-border pl-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}

export function PlatformClinicBillingDetailPage() {
  const { clinicId } = useParams<{ clinicId: string }>();
  const access = useAmIPlatformAdmin(true);
  const detail = usePlatformClinicBillingDetail(clinicId ?? null, access.isPlatformAdmin === true);

  if (detail.isLoading) return <Skeleton className="h-72 w-full" />;
  if (detail.isError) {
    return (
      <ErrorState
        title="Não foi possível abrir o faturamento desta clínica"
        description={platformBillingErrorMessage(detail.error)}
        onRetry={() => void detail.refetch()}
      />
    );
  }
  if (!detail.data?.found || !detail.data.clinic) {
    return (
      <EmptyState
        title="Clínica não encontrada"
        description="Este identificador não existe no catálogo da plataforma."
      />
    );
  }

  const clinic = detail.data.clinic;

  return (
    <div className="space-y-8">
      <div>
        <Link
          to="/platform/billing/contratos"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Voltar aos contratos
        </Link>
        <h2 className="mt-2 text-xl font-semibold">{clinic.clinicName}</h2>
        <p className="text-sm text-muted-foreground">
          Leitura operacional. Sem impersonar o administrador da clínica.
        </p>
      </div>

      <section aria-labelledby="bp05-detail-facts">
        <h3 id="bp05-detail-facts" className="sr-only">
          Situação da clínica
        </h3>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Contrato" value={`${clinicPlanCopy(clinic)} · ${contractStatusLabel(clinic.contractStatus)}`} />
          <Fact
            label="Pix Automático Sandbox"
            value={pixAutomaticStatusLabel(clinic.provider.sandbox.pixStatus)}
          />
          <Fact
            label="Pix Automático Produção"
            value={pixAutomaticStatusLabel(clinic.provider.production.pixStatus)}
          />
          <Fact label="Identidade" value={identityLabel(clinic.identityComplete)} />
          <Fact label="Cliente do provedor" value={customerBoundLabel(clinic.customerBound)} />
          <div className="border-l border-border pl-3">
            <dt className="text-xs text-muted-foreground">Situação financeira</dt>
            <dd className="mt-1">
              <StatusChip
                label={financialSummaryLabel(clinic.financialSummary)}
                tone={financialSummaryTone(clinic.financialSummary)}
              />
            </dd>
          </div>
          <Fact
            label="Vencido Sandbox"
            value={
              clinic.provider.sandbox.overdueCount > 0
                ? `${clinic.provider.sandbox.overdueCount} · ${formatPlatformMoney(clinic.provider.sandbox.overdueCents)}`
                : "Nenhuma cobrança vencida"
            }
          />
          <Fact
            label="Vencido Produção"
            value={
              clinic.provider.production.overdueCount > 0
                ? `${clinic.provider.production.overdueCount} · ${formatPlatformMoney(clinic.provider.production.overdueCents)}`
                : "Nenhuma cobrança vencida"
            }
          />
          <Fact
            label="Próxima cobrança Sandbox"
            value={nextChargeCopy(clinic.provider.sandbox.nextCharge)}
          />
          <Fact
            label="Próxima cobrança Produção"
            value={nextChargeCopy(clinic.provider.production.nextCharge)}
          />
          <Fact
            label="Último pagamento Sandbox"
            value={
              clinic.provider.sandbox.latestPaymentDate
                ? `${formatPlatformDate(clinic.provider.sandbox.latestPaymentDate)} · ${clinic.provider.sandbox.latestPaymentState ?? "—"}`
                : "—"
            }
          />
          <Fact
            label="Último pagamento Produção"
            value={
              clinic.provider.production.latestPaymentDate
                ? `${formatPlatformDate(clinic.provider.production.latestPaymentDate)} · ${clinic.provider.production.latestPaymentState ?? "—"}`
                : "—"
            }
          />
          <Fact
            label="Atenção"
            value={clinic.attention ? attentionReasonLabel(clinic.attentionReason) : "Sem atenção"}
          />
          <Fact label="Liberação do produto" value="Desligada" />
        </dl>
      </section>

      <section aria-labelledby="bp05-detail-charges">
        <h3 id="bp05-detail-charges" className="text-sm font-medium">
          Cobranças
        </h3>
        {detail.data.charges.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Ainda não há cobrança registrada.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/70">
            {detail.data.charges.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span>
                  {formatPlatformMoney(row.amountCents)} · venc. {formatPlatformDate(row.dueDate)} ·{" "}
                  {billingMethodLabel(row.method)}
                  {providerEnvironmentLabel(row.environment)
                    ? ` · ${providerEnvironmentLabel(row.environment)}`
                    : ""}
                </span>
                <StatusChip
                  label={chargeStateLabel(row.displayState)}
                  tone={chargeStateTone(row.displayState)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="bp05-detail-pays">
        <h3 id="bp05-detail-pays" className="text-sm font-medium">
          Pagamentos
        </h3>
        {detail.data.payments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Ainda não há pagamento registrado.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/70">
            {detail.data.payments.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span>
                  {formatPlatformMoney(row.amountCents)} · {billingMethodLabel(row.method)}
                  {row.receivedDate ? ` · recebido ${formatPlatformDate(row.receivedDate)}` : ""}
                  {providerEnvironmentLabel(row.environment)
                    ? ` · ${providerEnvironmentLabel(row.environment)}`
                    : ""}
                </span>
                <StatusChip
                  label={paymentStateLabel(row.displayState)}
                  tone={paymentStateTone(row.displayState)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="bp05-detail-timeline">
        <h3 id="bp05-detail-timeline" className="text-sm font-medium">
          Linha do tempo comercial
        </h3>
        {detail.data.businessTimeline.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nenhum evento comercial derivado ainda.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {detail.data.businessTimeline.map((event) => (
              <li key={event.id}>
                {formatPlatformDate(event.occurredAt)} — {timelineEventLabel(event.type)}
                {providerEnvironmentLabel(event.environment)
                  ? ` · ${providerEnvironmentLabel(event.environment)}`
                  : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="bp05-detail-events">
        <h3 id="bp05-detail-events" className="text-sm font-medium">
          Eventos técnicos
        </h3>
        {detail.data.events.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nenhum evento técnico correlacionado.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {detail.data.events.map((event) => (
              <li key={event.id}>
                {eventTypeLabel(event.eventType)} · {processingStatusLabel(event.processingStatus)}
                {event.failureCategory ? ` · ${event.failureCategory}` : ""} ·{" "}
                {formatPlatformDate(event.receivedAt)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
