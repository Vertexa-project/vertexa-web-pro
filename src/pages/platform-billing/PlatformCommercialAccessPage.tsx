import { useState } from "react";

import { ErrorState } from "@/components/feedback/ErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import {
  useGrantCommercialExemption,
  usePlatformCommercialAccess,
  useRevokeCommercialExemption,
  useSetCommercialAccessMode,
} from "@/hooks/useCommercialAccess";
import { commercialErrorMessage } from "@/lib/domain/billingCommercial";

function ModeBadge({ value }: { value: string }) {
  return (
    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide">
      {value}
    </span>
  );
}

export function PlatformCommercialAccessPage() {
  const access = useAmIPlatformAdmin(true);
  const enabled = access.isPlatformAdmin === true;
  const overview = usePlatformCommercialAccess(enabled);
  const setMode = useSetCommercialAccessMode();
  const grant = useGrantCommercialExemption();
  const revoke = useRevokeCommercialExemption();
  const [clinicId, setClinicId] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [confirmEnforce, setConfirmEnforce] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function run(promise: Promise<unknown>) {
    setActionError(null);
    void promise.catch((error: unknown) => {
      setActionError(commercialErrorMessage(error));
    });
  }

  if (overview.isLoading) return <Skeleton className="h-72 w-full" />;
  if (overview.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o acesso comercial"
        description={commercialErrorMessage(overview.error)}
        onRetry={() => void overview.refetch()}
      />
    );
  }

  const data = overview.data;
  const clinics = data?.clinics ?? [];
  const preContract = clinics.filter((row) => row.accessClass === "PRE_CONTRACT");
  const activeExemptions = (data?.exemptions ?? []).filter((row) => row.active);
  const inactiveExemptions = (data?.exemptions ?? []).filter((row) => !row.active);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Acesso comercial</h2>
        <p className="text-sm text-muted-foreground">
          Contrato ativo ou isenção explícita da plataforma liberam o produto. Observação não
          bloqueia clínicas existentes. Entitlement permanece desligado.
        </p>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border-l border-border pl-4">
            <dt className="text-xs text-muted-foreground">Modo de rollout</dt>
            <dd className="mt-1">
              <ModeBadge value={data?.rolloutMode ?? "OBSERVE"} />
            </dd>
          </div>
          <div className="border-l border-border pl-4">
            <dt className="text-xs text-muted-foreground">Escrita Production</dt>
            <dd className="mt-1">
              <ModeBadge value={data?.providerWriteMode ?? "LOCKED"} />
            </dd>
          </div>
          <div className="border-l border-border pl-4">
            <dt className="text-xs text-muted-foreground">PRE_CONTRACT</dt>
            <dd className="mt-1 font-display text-xl font-semibold">{preContract.length}</dd>
          </div>
          <div className="border-l border-border pl-4">
            <dt className="text-xs text-muted-foreground">Isenções ativas</dt>
            <dd className="mt-1 font-display text-xl font-semibold">{activeExemptions.length}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={setMode.isPending || data?.rolloutMode === "OBSERVE"}
            onClick={() => void run(setMode.mutateAsync("observe"))}
          >
            Manter observação
          </Button>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={confirmEnforce}
              onChange={(event) => setConfirmEnforce(event.target.checked)}
            />
            Clínicas sem contrato foram classificadas
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={setMode.isPending || !confirmEnforce || data?.rolloutMode === "ENFORCE"}
            onClick={() => void run(setMode.mutateAsync("enforce"))}
          >
            Ativar enforcement
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          A troca de modo não é automática. Enforcement comercial não ativa Asaas Production.
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Clínicas</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-2 font-medium">Clínica</th>
                <th className="py-2 font-medium">Classe</th>
                <th className="py-2 font-medium">Origem</th>
                <th className="py-2 font-medium">Contrato</th>
                <th className="py-2 font-medium">Isenção</th>
                <th className="py-2 font-medium">Contas</th>
              </tr>
            </thead>
            <tbody>
              {clinics.map((row) => (
                <tr key={row.clinicId} className="border-b border-border/60">
                  <td className="py-2">{row.clinicName}</td>
                  <td className="py-2">{row.accessClass}</td>
                  <td className="py-2">{row.reason}</td>
                  <td className="py-2">{row.hasActiveContract ? "ativo" : "não"}</td>
                  <td className="py-2">{row.hasActiveExemption ? "ativa" : "não"}</td>
                  <td className="py-2">
                    {[
                      row.hasSandboxAccount ? "sandbox" : null,
                      row.hasProductionAccount ? "production" : null,
                    ]
                      .filter(Boolean)
                      .join(" + ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Conceder isenção</h3>
        <p className="text-sm text-muted-foreground">
          Isenção não é Founder, cupom, pagamento nem entitlement. Só Platform Admin.
        </p>
        <div className="grid gap-3 lg:grid-cols-3">
          <div>
            <Label htmlFor="preprod02-clinic" className="text-xs text-muted-foreground">
              Clínica
            </Label>
            <Input
              id="preprod02-clinic"
              value={clinicId}
              onChange={(event) => setClinicId(event.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="preprod02-reason" className="text-xs text-muted-foreground">
              Motivo
            </Label>
            <Input
              id="preprod02-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="preprod02-expires" className="text-xs text-muted-foreground">
              Expira em (opcional)
            </Label>
            <Input
              id="preprod02-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="mt-1"
            />
          </div>
        </div>
        <Button
          type="button"
          disabled={grant.isPending || clinicId.trim().length === 0 || reason.trim().length < 8}
          onClick={() =>
            void run(
              grant.mutateAsync({
                clinicId: clinicId.trim(),
                reason: reason.trim(),
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
              }),
            )
          }
        >
          Conceder isenção
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Isenções ativas</h3>
        {activeExemptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma isenção ativa.</p>
        ) : (
          <ul className="space-y-2">
            {activeExemptions.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 py-2">
                <div>
                  <p className="text-sm font-medium">{row.clinicName}</p>
                  <p className="text-xs text-muted-foreground">{row.reason}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={revoke.isPending}
                  onClick={() => void run(revoke.mutateAsync(row.id))}
                >
                  Revogar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Isenções expiradas ou revogadas</h3>
        {inactiveExemptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum histórico ainda.</p>
        ) : (
          <ul className="space-y-2 text-sm text-muted-foreground">
            {inactiveExemptions.map((row) => (
              <li key={row.id}>
                {row.clinicName} — {row.revokedAt ? "revogada" : "expirada"}
              </li>
            ))}
          </ul>
        )}
      </section>

      {actionError ? (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}
