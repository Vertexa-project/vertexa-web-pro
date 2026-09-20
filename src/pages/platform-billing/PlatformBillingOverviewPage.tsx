import { Link } from "react-router-dom";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LedgerList } from "@/components/platform-billing/LedgerList";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import {
  usePlatformBillingEvents,
  usePlatformBillingClinics,
  usePlatformBillingOverview,
} from "@/hooks/usePlatformBilling";
import {
  agingBucketLabel,
  eventTypeLabel,
  formatPlatformDate,
  formatPlatformMoney,
  platformBillingErrorMessage,
  processingStatusLabel,
  type PlatformAgingBucket,
} from "@/lib/domain/platformBilling";
import { clinicColumns, clinicHref, clinicMobile } from "./clinicColumns";

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-l border-border pl-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-display text-xl font-semibold tracking-tight">{value}</dd>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PlatformBillingOverviewPage() {
  const access = useAmIPlatformAdmin(true);
  const enabled = access.isPlatformAdmin === true;
  const overview = usePlatformBillingOverview(enabled);
  const attention = usePlatformBillingClinics(enabled, { needsAttention: true, limit: 20 });
  const events = usePlatformBillingEvents(enabled, { limit: 8 });

  if (overview.isLoading || attention.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (overview.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar a visão geral"
        description={platformBillingErrorMessage(overview.error)}
        onRetry={() => void overview.refetch()}
      />
    );
  }

  const data = overview.data;
  const aging = data?.aging;

  return (
    <div className="space-y-8">
      <section aria-labelledby="bp05-month">
        <h2 id="bp05-month" className="text-sm font-medium text-foreground">
          Mês corrente em {data?.timezone ?? "America/Sao_Paulo"}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {data?.periodStart ? `${formatPlatformDate(data.periodStart)} — ${formatPlatformDate(data.periodEnd)}` : "Período civil"}
          . Valores recebidos e vencidos; isto não é MRR.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-6 lg:grid-cols-4">
          <Metric label="Recebido no mês" value={formatPlatformMoney(data?.receivedInPeriodCents)} />
          <Metric label="Em aberto" value={formatPlatformMoney(data?.pendingAmountCents)} />
          <Metric
            label="Vencido"
            value={formatPlatformMoney(data?.overdueAmountCents)}
            hint={`${data?.delinquentClinics ?? 0} ${(data?.delinquentClinics ?? 0) === 1 ? "clínica inadimplente" : "clínicas inadimplentes"}`}
          />
          <Metric
            label="Precisam de atenção"
            value={String(data?.attentionClinicCount ?? 0)}
            hint={`${data?.activeCommercialContracts ?? 0} contratos ativos · ${data?.activePixAutomaticAuthorizations ?? 0} Pix ativos`}
          />
        </dl>
      </section>

      <section aria-labelledby="bp05-aging">
        <h2 id="bp05-aging" className="text-sm font-medium text-foreground">
          Envelhecimento do vencido
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(["d1_7", "d8_15", "d16_30", "d31_plus"] as PlatformAgingBucket[]).map((bucket) => (
            <div key={bucket} className="rounded-md border border-border/70 p-3">
              <dt className="text-xs text-muted-foreground">{agingBucketLabel(bucket)}</dt>
              <dd className="mt-1 text-sm font-medium">
                {aging?.[bucket].clinicCount ?? 0} clínicas ·{" "}
                {formatPlatformMoney(aging?.[bucket].amountCents)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="bp05-attention">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="bp05-attention" className="text-sm font-medium text-foreground">
            Clínicas que pedem atenção
          </h2>
          <Link to="/platform/billing/contratos" className="text-sm text-primary underline-offset-4 hover:underline">
            Ver contratos
          </Link>
        </div>
        {attention.isError ? (
          <ErrorState
            title="Não foi possível carregar as clínicas"
            description={platformBillingErrorMessage(attention.error)}
            onRetry={() => void attention.refetch()}
          />
        ) : null}
        {!attention.isError && (attention.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Nenhuma clínica pede atenção agora"
            description="Não há cobrança vencida, identidade incompleta, cliente desvinculado ou Pix recusado neste recorte."
          />
        ) : null}
        {(attention.data?.items.length ?? 0) > 0 ? (
          <LedgerList
            columns={clinicColumns()}
            rows={attention.data?.items ?? []}
            getRowId={(row) => row.clinicId}
            ariaLabel="Clínicas que pedem atenção"
            onRowHref={clinicHref}
            mobile={clinicMobile}
            attention={(row) => row.attention}
          />
        ) : null}
      </section>

      <section aria-labelledby="bp05-events">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="bp05-events" className="text-sm font-medium text-foreground">
            Eventos recentes
          </h2>
          <Link to="/platform/billing/eventos" className="text-sm text-primary underline-offset-4 hover:underline">
            Ver eventos
          </Link>
        </div>
        {events.isError ? (
          <ErrorState
            title="Não foi possível carregar os eventos"
            description={platformBillingErrorMessage(events.error)}
            onRetry={() => void events.refetch()}
          />
        ) : null}
        {!events.isError && (events.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Ainda não há eventos"
            description="O ledger operacional aparece aqui depois que o provedor entregar webhooks."
          />
        ) : null}
        <ul className="divide-y divide-border/70">
          {(events.data?.items ?? []).map((event) => (
            <li key={event.id} className="py-3 text-sm">
              <p className="font-medium">{eventTypeLabel(event.eventType)}</p>
              <p className="text-muted-foreground">
                {event.clinicName ?? "Clínica não correlacionada"} ·{" "}
                {processingStatusLabel(event.processingStatus)}
                {event.failureCategory ? ` · ${event.failureCategory}` : ""} ·{" "}
                {formatPlatformDate(event.receivedAt)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
