import { useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LedgerList } from "@/components/platform-billing/LedgerList";
import { Label } from "@/components/ui/label";
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
import {
  REPORT_ENVIRONMENT_VIEWS,
  type PlatformBillingReportEnvironmentView,
} from "@/lib/domain/platformBillingReports";
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
  const [envView, setEnvView] = useState<PlatformBillingReportEnvironmentView>("comparison");
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
  const showSandbox = envView === "comparison" || envView === "sandbox";
  const showProduction = envView === "comparison" || envView === "production";

  return (
    <div className="space-y-8">
      <section aria-labelledby="bp05-month">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="bp05-month" className="text-sm font-medium text-foreground">
              Mês corrente em {data?.timezone ?? "America/Sao_Paulo"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {data?.periodStart ? `${formatPlatformDate(data.periodStart)} — ${formatPlatformDate(data.periodEnd)}` : "Período civil"}
              . Valores recebidos e vencidos; isto não é MRR.
            </p>
          </div>
          <div className="min-w-[12rem]">
            <Label htmlFor="bp05-env" className="text-xs text-muted-foreground">
              Ambiente
            </Label>
            <select
              id="bp05-env"
              value={envView}
              onChange={(event) =>
                setEnvView(event.target.value as PlatformBillingReportEnvironmentView)
              }
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {REPORT_ENVIRONMENT_VIEWS.map((view) => (
                <option key={view} value={view}>
                  {view === "comparison" ? "Comparação" : view === "sandbox" ? "Sandbox" : "Produção"}
                </option>
              ))}
            </select>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-6 lg:grid-cols-4">
          {showSandbox ? (
            <>
              <Metric
                label="Recebido Sandbox"
                value={formatPlatformMoney(data?.financial.sandbox.receivedCents)}
              />
              <Metric
                label="Em aberto Sandbox"
                value={formatPlatformMoney(data?.financial.sandbox.pendingCents)}
              />
              <Metric
                label="Vencido Sandbox"
                value={formatPlatformMoney(data?.financial.sandbox.overdueCents)}
                hint={`${data?.delinquent.sandbox ?? 0} ${(data?.delinquent.sandbox ?? 0) === 1 ? "clínica inadimplente" : "clínicas inadimplentes"}`}
              />
            </>
          ) : null}
          {showProduction ? (
            <>
              <Metric
                label="Recebido Produção"
                value={formatPlatformMoney(data?.financial.production.receivedCents)}
              />
              <Metric
                label="Em aberto Produção"
                value={formatPlatformMoney(data?.financial.production.pendingCents)}
              />
              <Metric
                label="Vencido Produção"
                value={formatPlatformMoney(data?.financial.production.overdueCents)}
                hint={`${data?.delinquent.production ?? 0} ${(data?.delinquent.production ?? 0) === 1 ? "clínica inadimplente" : "clínicas inadimplentes"}`}
              />
            </>
          ) : null}
          <Metric
            label="Precisam de atenção"
            value={String(data?.attentionClinicCount ?? 0)}
            hint={`${data?.activeCommercialContracts ?? 0} contratos ativos · Pix Sandbox ${data?.activePixAutomaticAuthorizations.sandbox ?? 0} · Pix Produção ${data?.activePixAutomaticAuthorizations.production ?? 0}`}
          />
        </dl>
      </section>

      {showSandbox ? (
        <section aria-labelledby="bp05-aging-sandbox">
          <h2 id="bp05-aging-sandbox" className="text-sm font-medium text-foreground">
            Envelhecimento do vencido · Sandbox
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(["d1_7", "d8_15", "d16_30", "d31_plus"] as PlatformAgingBucket[]).map((bucket) => (
              <div key={`sandbox-${bucket}`} className="rounded-md border border-border/70 p-3">
                <dt className="text-xs text-muted-foreground">{agingBucketLabel(bucket)}</dt>
                <dd className="mt-1 text-sm font-medium">
                  {data?.aging.sandbox[bucket].clinicCount ?? 0} clínicas ·{" "}
                  {formatPlatformMoney(data?.aging.sandbox[bucket].amountCents)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {showProduction ? (
        <section aria-labelledby="bp05-aging-production">
          <h2 id="bp05-aging-production" className="text-sm font-medium text-foreground">
            Envelhecimento do vencido · Produção
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(["d1_7", "d8_15", "d16_30", "d31_plus"] as PlatformAgingBucket[]).map((bucket) => (
              <div key={`production-${bucket}`} className="rounded-md border border-border/70 p-3">
                <dt className="text-xs text-muted-foreground">{agingBucketLabel(bucket)}</dt>
                <dd className="mt-1 text-sm font-medium">
                  {data?.aging.production[bucket].clinicCount ?? 0} clínicas ·{" "}
                  {formatPlatformMoney(data?.aging.production[bucket].amountCents)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

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
