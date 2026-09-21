import { useMemo, useState } from "react";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import { usePlatformBillingReport } from "@/hooks/usePlatformBilling";
import { listPlatformBillingReportExport } from "@/lib/api/platformBillingReports";
import { billingCsvFilename, downloadCsvFile } from "@/lib/domain/billingCsv";
import {
  agingBucketLabel,
  pixAutomaticStatusLabel,
} from "@/lib/domain/platformBilling";
import { providerEnvironmentLabel } from "@/lib/domain/billingHub";
import {
  buildBillingReportCsv,
  currentSaoPauloMonth,
  paymentStatusLabel,
  planAttributionLabel,
  platformReportErrorMessage,
  reportDate,
  reportMoney,
  validateReportPeriod,
  type PlatformBillingReportEnvironmentView,
  type PlatformBillingReportKind,
} from "@/lib/domain/platformBillingReports";

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border-l border-border pl-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-display text-xl font-semibold tracking-tight">{value}</dd>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PlatformBillingReportsPage() {
  const access = useAmIPlatformAdmin(true);
  const defaults = useMemo(() => currentSaoPauloMonth(), []);
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [kind, setKind] = useState<PlatformBillingReportKind>("payments");
  const [envView, setEnvView] = useState<PlatformBillingReportEnvironmentView>("comparison");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportEmpty, setExportEmpty] = useState(false);

  const periodError = validateReportPeriod(start, end);
  const enabled = access.isPlatformAdmin === true && periodError == null;
  const report = usePlatformBillingReport(enabled, start, end);

  async function exportCsv() {
    if (periodError) return;
    setExporting(true);
    setExportError(null);
    setExportEmpty(false);
    try {
      const page = await listPlatformBillingReportExport({
        periodStart: start,
        periodEnd: end,
        kind,
        environment: envView === "comparison" ? null : envView,
        limit: 500,
        offset: 0,
      });
      if (page.items.length === 0) {
        setExportEmpty(true);
        return;
      }
      downloadCsvFile(
        billingCsvFilename(kind, page.periodStart || start, page.periodEnd || end),
        buildBillingReportCsv(kind, page),
      );
    } catch (error) {
      setExportError(platformReportErrorMessage(error));
    } finally {
      setExporting(false);
    }
  }

  if (report.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (report.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar os relatórios"
        description={platformReportErrorMessage(report.error)}
        onRetry={() => void report.refetch()}
      />
    );
  }

  const data = report.data;

  return (
    <div className="space-y-8">
      <section aria-labelledby="bp06-period" className="space-y-4">
        <div>
          <h2 id="bp06-period" className="text-lg font-semibold">
            Relatórios operacionais
          </h2>
          <p className="text-sm text-muted-foreground">
            Recorte civil em America/Sao_Paulo. Recebido usa a data de pagamento; em aberto e
            vencido usam o vencimento. Isto não é MRR.
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="min-w-[10rem]">
            <Label htmlFor="bp06-start" className="text-xs text-muted-foreground">
              Início
            </Label>
            <Input
              id="bp06-start"
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className="mt-1"
            />
          </div>
          <div className="min-w-[10rem]">
            <Label htmlFor="bp06-end" className="text-xs text-muted-foreground">
              Fim
            </Label>
            <Input
              id="bp06-end"
              type="date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              className="mt-1"
            />
          </div>
          <div className="min-w-[12rem]">
            <Label htmlFor="bp06-env" className="text-xs text-muted-foreground">
              Ambiente
            </Label>
            <select
              id="bp06-env"
              value={envView}
              onChange={(event) =>
                setEnvView(event.target.value as PlatformBillingReportEnvironmentView)
              }
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="comparison">Comparação</option>
              <option value="sandbox">Sandbox</option>
              <option value="production">Produção</option>
            </select>
          </div>
          <div className="min-w-[12rem]">
            <Label htmlFor="bp06-kind" className="text-xs text-muted-foreground">
              Exportação CSV
            </Label>
            <select
              id="bp06-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as PlatformBillingReportKind)}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="payments">Pagamentos do recorte</option>
              <option value="received_by_plan">Recebido por plano</option>
              <option value="delinquent">Clínicas inadimplentes</option>
            </select>
          </div>
          <Button
            type="button"
            onClick={() => void exportCsv()}
            disabled={exporting || periodError != null}
          >
            {exporting ? "Preparando CSV…" : "Exportar CSV"}
          </Button>
        </div>
        {periodError ? (
          <p role="alert" className="text-sm text-destructive">
            {periodError}
          </p>
        ) : null}
        {exportEmpty ? (
          <p role="status" className="text-sm text-muted-foreground">
            Não há linhas neste recorte para exportar.
          </p>
        ) : null}
        {exportError ? (
          <p role="alert" className="text-sm text-destructive">
            {exportError}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="bp06-summary">
        <h3 id="bp06-summary" className="text-sm font-medium">
          Recebido, em aberto e vencido
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {data ? `${reportDate(data.periodStart)} — ${reportDate(data.periodEnd)}` : "Período civil"}.
          Sandbox não é receita de Produção.
        </p>
        {(envView === "comparison" || envView === "sandbox") && (
          <div className="mt-4 space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sandbox</h4>
            <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <Metric
                label="Recebido Sandbox"
                value={reportMoney(data?.financial.sandbox.receivedCents ?? 0)}
                hint={`${data?.financial.sandbox.receivedCount ?? 0} pagamentos`}
              />
              <Metric
                label="Em aberto Sandbox"
                value={reportMoney(data?.financial.sandbox.pendingCents ?? 0)}
                hint={`${data?.financial.sandbox.pendingCount ?? 0} cobranças`}
              />
              <Metric
                label="Vencido Sandbox"
                value={reportMoney(data?.financial.sandbox.overdueCents ?? 0)}
                hint={`${data?.financial.sandbox.overdueCount ?? 0} cobranças`}
              />
            </dl>
          </div>
        )}
        {(envView === "comparison" || envView === "production") && (
          <div className="mt-6 space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Produção</h4>
            <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <Metric
                label="Recebido Produção"
                value={reportMoney(data?.financial.production.receivedCents ?? 0)}
                hint={`${data?.financial.production.receivedCount ?? 0} pagamentos`}
              />
              <Metric
                label="Em aberto Produção"
                value={reportMoney(data?.financial.production.pendingCents ?? 0)}
                hint={`${data?.financial.production.pendingCount ?? 0} cobranças`}
              />
              <Metric
                label="Vencido Produção"
                value={reportMoney(data?.financial.production.overdueCents ?? 0)}
                hint={`${data?.financial.production.overdueCount ?? 0} cobranças`}
              />
            </dl>
          </div>
        )}
      </section>

      <section aria-labelledby="bp07-commercial">
        <h3 id="bp07-commercial" className="text-sm font-medium">
          Projeção comercial
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Founder e capacidade. Isto não é recebido, pendente nem vencido.
        </p>
        <dl className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Admissões Founder"
            value={`${data?.commercial.founderAdmissionsUsed ?? 0} / 50`}
            hint={`${data?.commercial.founderAdmissionsRemaining ?? 50} restantes · ${data?.commercial.founderActive ?? 0} ativos`}
          />
          <Metric
            label="Desconto comercial projetado"
            value={reportMoney(data?.commercial.projectedCommercialDiscountCents ?? 0)}
            hint="Não é receita recebida"
          />
          <Metric
            label="Unidades adicionais"
            value={`${data?.commercial.additionalProfessionalUnits ?? 0} prof. · ${data?.commercial.additionalPatientUnits ?? 0} pac.`}
            hint={reportMoney(data?.commercial.projectedAdditionalRevenueCents ?? 0)}
          />
          <Metric
            label="Consumo de capacidade"
            value={`${data?.commercial.professionalCapacityUsed ?? 0}/${data?.commercial.professionalCapacityAllowed ?? 0} · ${data?.commercial.patientCapacityUsed ?? 0}/${data?.commercial.patientCapacityAllowed ?? 0}`}
            hint="Profissionais · pacientes"
          />
        </dl>
      </section>

      <section aria-labelledby="bp06-plan" className="space-y-3">
        <h3 id="bp06-plan" className="text-sm font-medium">
          Recebido por plano
        </h3>
        {(data?.receivedByPlan.length ?? 0) === 0 ? (
          <EmptyState
            title="Nenhum recebimento neste recorte"
            description="O zero aqui é ausência de pagamento recebido — não um plano inventado."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <caption className="sr-only">Recebido por plano no recorte</caption>
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="py-2 font-medium">
                    Ambiente
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Plano
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Atribuição
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Recebido
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Pagamentos
                  </th>
                </tr>
              </thead>
              <tbody>
                {data?.receivedByPlan.map((row) => (
                  <tr
                    key={`${row.environment ?? "none"}-${row.planCode ?? "none"}-${row.planAttribution}`}
                    className="border-b border-border/60"
                  >
                    <td className="py-2">{providerEnvironmentLabel(row.environment) ?? "—"}</td>
                    <td className="py-2">{row.planDisplayName ?? row.planCode ?? "Não atribuído"}</td>
                    <td className="py-2 text-muted-foreground">{planAttributionLabel(row.planAttribution)}</td>
                    <td className="py-2">{reportMoney(row.receivedCents)}</td>
                    <td className="py-2">{row.paymentCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="bp06-status" className="space-y-3">
        <h3 id="bp06-status" className="text-sm font-medium">
          Pagamentos por situação
        </h3>
        {(data?.paymentsByStatus.length ?? 0) === 0 ? (
          <EmptyState
            title="Nenhum pagamento neste recorte"
            description="Ajuste as datas ou aguarde a primeira cobrança liquidada."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data?.paymentsByStatus
              .filter((row) => envView === "comparison" || row.environment === envView)
              .map((row) => (
              <li key={`${row.environment ?? "none"}-${row.status}`} className="border-l border-border pl-4">
                <p className="text-xs text-muted-foreground">
                  {paymentStatusLabel(row.status)}
                  {row.environment ? ` · ${providerEnvironmentLabel(row.environment)}` : ""}
                </p>
                <p className="mt-1 font-medium">{reportMoney(row.amountCents)}</p>
                <p className="text-xs text-muted-foreground">{row.paymentCount} registros</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="bp06-pix">
        <h3 id="bp06-pix" className="text-sm font-medium">
          Pix Automático ativo
        </h3>
        <p className="mt-2 text-sm">
          Sandbox: {data?.activePixAutomaticAuthorizations.sandbox ?? 0} autorizações primárias
          ativas. Produção: {data?.activePixAutomaticAuthorizations.production ?? 0}. Recusa de Pix
          não entra nesta conta e não é inadimplência.
        </p>
      </section>

      <section aria-labelledby="bp06-delinq" className="space-y-3">
        <h3 id="bp06-delinq" className="text-sm font-medium">
          Clínicas inadimplentes
        </h3>
        {(data?.delinquentItems.length ?? 0) === 0 ? (
          <EmptyState
            title="Nenhuma clínica inadimplente"
            description="Inadimplência exige cobrança vencida. Pix recusado sozinho não aparece aqui."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">Clínicas com cobrança vencida</caption>
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="py-2 font-medium">
                    Clínica
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Ambiente
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Vencido
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Envelhecimento
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Pix
                  </th>
                </tr>
              </thead>
              <tbody>
                {data?.delinquentItems
                  .filter((row) => envView === "comparison" || row.environment === envView)
                  .map((row) => (
                  <tr key={`${row.clinicId}-${row.environment ?? "none"}`} className="border-b border-border/60">
                    <td className="py-2">{row.clinicName}</td>
                    <td className="py-2">{providerEnvironmentLabel(row.environment) ?? "—"}</td>
                    <td className="py-2">
                      {row.overdueCount} · {reportMoney(row.overdueCents)}
                    </td>
                    <td className="py-2">
                      {row.agingBucket ? agingBucketLabel(row.agingBucket) : "—"}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {row.pixStatus ? pixAutomaticStatusLabel(row.pixStatus) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
