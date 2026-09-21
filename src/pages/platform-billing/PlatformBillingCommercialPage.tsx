import { useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import {
  useAdmitPlatformFounder,
  useCancelPlatformFounder,
  useClosePlatformFounderCampaign,
  usePlatformClinicCommercialDetail,
  usePlatformCommercialGovernance,
  usePlatformCommercialPlanOptions,
  useRestorePlatformFounder,
  useSetPlatformAdditionalCapacity,
} from "@/hooks/useBillingCommercial";
import {
  commercialErrorMessage,
  commercialMoney,
  type PlatformFounderAdmissionRow,
} from "@/lib/domain/billingCommercial";

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-l border-border pl-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-display text-xl font-semibold tracking-tight">{value}</dd>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PlatformBillingCommercialPage() {
  const access = useAmIPlatformAdmin(true);
  const enabled = access.isPlatformAdmin === true;
  const gov = usePlatformCommercialGovernance(enabled);
  const plans = usePlatformCommercialPlanOptions(enabled);
  const admit = useAdmitPlatformFounder();
  const closeCampaign = useClosePlatformFounderCampaign();
  const cancelFounder = useCancelPlatformFounder();
  const restoreFounder = useRestorePlatformFounder();
  const setUnits = useSetPlatformAdditionalCapacity();
  const [clinicId, setClinicId] = useState("");
  const [planCode, setPlanCode] = useState("sync");
  const [addProf, setAddProf] = useState("0");
  const [addPat, setAddPat] = useState("0");
  const [selectedClinic, setSelectedClinic] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const detail = usePlatformClinicCommercialDetail(selectedClinic, enabled && Boolean(selectedClinic));

  function run(promise: Promise<unknown> | undefined) {
    setActionError(null);
    void Promise.resolve(promise).catch((error: unknown) => {
      setActionError(commercialErrorMessage(error));
    });
  }

  if (gov.isLoading) return <Skeleton className="h-72 w-full" />;
  if (gov.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o governo comercial"
        description={commercialErrorMessage(gov.error)}
        onRetry={() => void gov.refetch()}
      />
    );
  }

  const data = gov.data;
  const admissions = data?.admissions ?? [];

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Founder Member</h2>
        <p className="text-sm text-muted-foreground">
          50 admissões históricas. Slot cancelado não volta ao estoque. Projeção comercial não é
          receita recebida.
        </p>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Campanha" value={data?.founderCampaignStatus === "open" ? "Aberta" : "Encerrada"} />
          <Metric
            label="Admissões usadas"
            value={`${data?.founderAdmissionsUsed ?? 0} / 50`}
            hint={`${data?.founderAdmissionsRemaining ?? 50} restantes`}
          />
          <Metric label="Founder ativos" value={String(data?.founderActive ?? 0)} />
          <Metric label="Históricos / cancelados" value={String(data?.founderHistorical ?? 0)} />
        </dl>
        {data?.founderCampaignStatus === "open" ? (
          <Button
            type="button"
            variant="outline"
            disabled={closeCampaign.isPending}
            onClick={() => void run(closeCampaign.mutateAsync())}
          >
            Encerrar campanha Founder
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">A campanha está encerrada. Novas admissões estão bloqueadas.</p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Admitir clínica Founder</h3>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-[16rem] flex-1">
            <Label htmlFor="bp07-clinic" className="text-xs text-muted-foreground">
              Clínica
            </Label>
            <Input
              id="bp07-clinic"
              value={clinicId}
              onChange={(event) => setClinicId(event.target.value)}
              placeholder="Identificador da clínica"
              className="mt-1"
            />
          </div>
          <div className="min-w-[10rem]">
            <Label htmlFor="bp07-plan" className="text-xs text-muted-foreground">
              Plano
            </Label>
            <select
              id="bp07-plan"
              value={planCode}
              onChange={(event) => setPlanCode(event.target.value)}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {["pulse", "sync", "apex"].map((code) => (
                <option key={code} value={code}>
                  {plans.data?.find((plan) => plan.code === code)?.displayName ?? code}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            disabled={!clinicId || admit.isPending || data?.founderCampaignStatus !== "open"}
            onClick={() => void run(admit.mutateAsync({ clinicId, planCode }))}
          >
            Admitir Founder
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          O servidor escolhe o slot, o preço Founder e a tabela. O navegador só envia clínica e plano.
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Admissões históricas</h3>
        {admissions.length === 0 ? (
          <EmptyState
            title="Nenhuma admissão Founder"
            description="Os 50 slots ainda não foram usados. Cancelar uma clínica não libera slot."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">Admissões Founder históricas</caption>
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2 font-medium">Slot</th>
                  <th className="py-2 font-medium">Clínica</th>
                  <th className="py-2 font-medium">Plano</th>
                  <th className="py-2 font-medium">Estado</th>
                  <th className="py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {admissions.map((row) => (
                  <AdmissionRow
                    key={`${row.clinicId}-${row.slotNumber}`}
                    row={row}
                    campaignOpen={data?.founderCampaignStatus === "open"}
                    pending={cancelFounder.isPending || restoreFounder.isPending}
                    onSelect={() => setSelectedClinic(row.clinicId)}
                    onCancel={() => void run(cancelFounder.mutateAsync(row.clinicId))}
                    onRestore={() => void run(restoreFounder.mutateAsync(row.clinicId))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Capacidade adicional (administrativa)</h3>
        <p className="text-sm text-muted-foreground">
          Unidades contratadas explicitamente. Não dispara Asaas. Pulse não aceita unidade adicional.
        </p>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-[8rem]">
            <Label htmlFor="bp07-add-prof" className="text-xs text-muted-foreground">
              Profissionais extras
            </Label>
            <Input id="bp07-add-prof" type="number" min={0} value={addProf} onChange={(e) => setAddProf(e.target.value)} className="mt-1" />
          </div>
          <div className="min-w-[8rem]">
            <Label htmlFor="bp07-add-pat" className="text-xs text-muted-foreground">
              Pacientes extras
            </Label>
            <Input id="bp07-add-pat" type="number" min={0} value={addPat} onChange={(e) => setAddPat(e.target.value)} className="mt-1" />
          </div>
          <Button
            type="button"
            disabled={!selectedClinic || setUnits.isPending}
            onClick={() => {
              if (!selectedClinic) return;
              void run(
                setUnits.mutateAsync({
                  clinicId: selectedClinic,
                  additionalProfessionals: Number(addProf) || 0,
                  additionalPatients: Number(addPat) || 0,
                }),
              );
            }}
          >
            Aplicar unidades
          </Button>
        </div>
      </section>

      {selectedClinic ? (
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Detalhe comercial da clínica</h3>
          {detail.isLoading ? <Skeleton className="h-24 w-full" /> : null}
          {detail.data ? (
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Metric label="Projeção mensal" value={commercialMoney(detail.data.price.finalProjectedCents)} hint="Não é cobrança" />
              <Metric label="Tabela" value={commercialMoney(detail.data.price.tablePriceCents)} />
              <Metric
                label="Profissionais"
                value={`${detail.data.capacity.billableProfessionals} / ${detail.data.capacity.allowedProfessionals || "—"}`}
              />
              <Metric
                label="Pacientes"
                value={`${detail.data.capacity.activePatients} / ${detail.data.capacity.allowedPatients || "—"}`}
              />
            </dl>
          ) : null}
          <Link
            to={`/platform/billing/clinicas/${selectedClinic}`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Abrir faturamento operacional
          </Link>
        </section>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}

function AdmissionRow({
  row,
  campaignOpen,
  pending,
  onSelect,
  onCancel,
  onRestore,
}: {
  row: PlatformFounderAdmissionRow;
  campaignOpen: boolean;
  pending: boolean;
  onSelect: () => void;
  onCancel: () => void;
  onRestore: () => void;
}) {
  return (
    <tr className="border-b border-border/60">
      <td className="py-2">{row.slotNumber}</td>
      <td className="py-2">
        <button type="button" className="text-left underline-offset-4 hover:underline" onClick={onSelect}>
          {row.clinicName}
        </button>
      </td>
      <td className="py-2 uppercase">{row.planCode}</td>
      <td className="py-2">{row.benefitStatus}</td>
      <td className="py-2">
        <div className="flex flex-wrap gap-2">
          {row.benefitStatus === "eligible" ? (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onCancel}>
              Cancelar Founder
            </Button>
          ) : null}
          {row.benefitStatus === "returnable" ? (
            <Button type="button" size="sm" variant="outline" disabled={pending || !campaignOpen} onClick={onRestore}>
              Restaurar na campanha
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
