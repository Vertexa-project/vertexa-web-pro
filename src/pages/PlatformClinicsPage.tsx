import { useMemo, useState } from "react";
import { Building2, Loader2 } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/DataTable";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import {
  usePlatformClinicPixStatuses,
  usePlatformClinics,
  useReactivatePlatformClinic,
  useReissuePixAutomaticAuthorization,
  useSuspendPlatformClinic,
} from "@/hooks/usePlatformClinics";
import type { PlatformClinic } from "@/lib/api/platformAdmin";
import {
  canReactivateClinic,
  canSuspendClinic,
  clinicLifecycleErrorMessage,
  clinicLifecycleLabel,
  isExpectedClinicLifecycleError,
  normalizeSuspendReason,
} from "@/lib/domain/clinicLifecycle";
import {
  canReissuePixAutomatic,
  pixAutomaticReissueErrorMessage,
  pixAutomaticStatusLabel,
  isExpectedPixAutomaticReissueError,
  type PlatformClinicPixAutomaticStatus,
} from "@/lib/domain/pixAutomaticReissue";
import { PLATFORM_CLINIC_VISIBLE_COLUMNS } from "@/lib/domain/platformAdmin";
import { formatDate } from "@/lib/domain/format";
import { captureException } from "@/lib/observability/sentry";

function CatalogSkeleton() {
  return <Skeleton className="h-64 w-full" />;
}

function StatusBadge({ status }: { status: PlatformClinic["status"] }) {
  const suspended = status === "suspended";
  return (
    <span
      className={
        suspended
          ? "inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800"
          : "inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-800"
      }
    >
      {clinicLifecycleLabel(status)}
    </span>
  );
}

function PixStatusBadge({ status }: { status: string }) {
  const refused = status === "REFUSED";
  return (
    <span
      className={
        refused
          ? "inline-flex rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-800"
          : "inline-flex rounded-full bg-slate-500/15 px-2 py-0.5 text-xs font-medium text-slate-700"
      }
    >
      {pixAutomaticStatusLabel(status)}
    </span>
  );
}

export function PlatformClinicsPage() {
  const access = useAmIPlatformAdmin(true);
  const { data, isLoading, isError, refetch } = usePlatformClinics(access.isPlatformAdmin === true);
  const pix = usePlatformClinicPixStatuses(access.isPlatformAdmin === true);
  const suspend = useSuspendPlatformClinic();
  const reactivate = useReactivatePlatformClinic();
  const reissue = useReissuePixAutomaticAuthorization();
  const [target, setTarget] = useState<PlatformClinic | null>(null);
  const [mode, setMode] = useState<"suspend" | "reactivate" | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [reissueTarget, setReissueTarget] = useState<PlatformClinicPixAutomaticStatus | null>(null);
  const [reissueError, setReissueError] = useState<string | null>(null);

  const pendingAction = suspend.isPending || reactivate.isPending;
  const reasonOk = mode === "reactivate" || normalizeSuspendReason(reason) !== null;
  const pixByClinic = useMemo(() => {
    const map = new Map<string, PlatformClinicPixAutomaticStatus[]>();
    for (const row of pix.data ?? []) {
      const current = map.get(row.clinicId) ?? [];
      current.push(row);
      map.set(row.clinicId, current);
    }
    return map;
  }, [pix.data]);

  const columns: Column<PlatformClinic>[] = useMemo(
    () => [
      {
        key: PLATFORM_CLINIC_VISIBLE_COLUMNS[0],
        header: "Clínica",
        render: (row) => <span className="font-medium text-foreground">{row.clinicName}</span>,
      },
      {
        key: PLATFORM_CLINIC_VISIBLE_COLUMNS[1],
        header: "Criada em",
        render: (row) => formatDate(row.createdAt),
        className: "text-muted-foreground",
      },
      {
        key: PLATFORM_CLINIC_VISIBLE_COLUMNS[2],
        header: "Status",
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: "pixAutomatic",
        header: "Pix Automático",
        render: (row) => {
          const rows = pixByClinic.get(row.clinicId) ?? [];
          if (rows.length === 0) {
            return <span className="text-sm text-muted-foreground">Sem autorização</span>;
          }
          return (
            <div className="flex flex-col items-start gap-2">
              {rows.map((item) => (
                <div key={item.authorizationId} className="flex flex-col items-start gap-1">
                  <PixStatusBadge status={item.providerStatus} />
                  {canReissuePixAutomatic(item.providerStatus) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReissueError(null);
                        setReissueTarget(item);
                      }}
                      disabled={reissue.isPending}
                    >
                      Gerar nova autorização
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          );
        },
      },
      {
        key: PLATFORM_CLINIC_VISIBLE_COLUMNS[3],
        header: "Profissionais",
        render: (row) => <span className="tnum">{row.professionalCount}</span>,
      },
      {
        key: PLATFORM_CLINIC_VISIBLE_COLUMNS[4],
        header: "Pacientes",
        render: (row) => <span className="tnum">{row.patientCount}</span>,
      },
      {
        key: "lifecycle",
        header: <span className="sr-only">Lifecycle</span>,
        render: (row) => (
          <div className="flex flex-col items-end gap-1">
            {canSuspendClinic(row.status) ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setActionError(null);
                  setReason("");
                  setMode("suspend");
                  setTarget(row);
                }}
                disabled={pendingAction}
              >
                Suspender
              </Button>
            ) : null}
            {canReactivateClinic(row.status) ? (
              <Button
                size="sm"
                onClick={() => {
                  setActionError(null);
                  setReason("");
                  setMode("reactivate");
                  setTarget(row);
                }}
                disabled={pendingAction}
              >
                Reativar
              </Button>
            ) : null}
            {row.statusChangedAt ? (
              <p className="max-w-[16rem] text-right text-xs text-muted-foreground">
                Última mudança: {formatDate(row.statusChangedAt)}
                {row.statusReason ? ` · ${row.statusReason}` : ""}
              </p>
            ) : null}
          </div>
        ),
      },
    ],
    [pendingAction, pixByClinic, reissue.isPending],
  );

  async function confirmReissue() {
    if (!reissueTarget || reissue.isPending) return;
    try {
      await reissue.mutateAsync({
        clinicId: reissueTarget.clinicId,
        commercialContractId: reissueTarget.commercialContractId,
        authorizationId: reissueTarget.authorizationId,
      });
      setReissueTarget(null);
      setReissueError(null);
    } catch (err) {
      setReissueError(pixAutomaticReissueErrorMessage(err));
      if (!isExpectedPixAutomaticReissueError(err)) {
        captureException(err, { source: "platform", scope: "pix-automatic-reissue" });
      }
    }
  }

  async function confirmAction() {
    if (!target || !mode) return;
    try {
      if (mode === "suspend") {
        const normalized = normalizeSuspendReason(reason);
        if (!normalized) {
          setActionError("Informe o motivo da suspensão.");
          return;
        }
        await suspend.mutateAsync({ clinicId: target.clinicId, reason: normalized });
      } else {
        await reactivate.mutateAsync({
          clinicId: target.clinicId,
          reason: reason.trim() || null,
        });
      }
      setTarget(null);
      setMode(null);
      setReason("");
      setActionError(null);
    } catch (err) {
      setActionError(clinicLifecycleErrorMessage(err));
      if (!isExpectedClinicLifecycleError(err)) {
        captureException(err, { source: "platform", scope: "clinic-lifecycle" });
      }
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clínicas"
        description="Catálogo administrativo. Suspensão preserva dados e corta o acesso operacional."
      />

      {isLoading ? <CatalogSkeleton /> : null}

      {isError ? (
        <ErrorState
          title="Não foi possível carregar as clínicas"
          description="A listagem usa somente o catálogo da plataforma. Tente novamente."
          onRetry={() => void refetch()}
        />
      ) : null}

      {!isLoading && !isError && (data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhuma clínica cadastrada"
          description="Quando houver clínicas na plataforma, elas aparecem aqui."
        />
      ) : null}

      {!isLoading && !isError && (data?.length ?? 0) > 0 ? (
        <DataTable
          columns={columns}
          rows={data ?? []}
          getRowId={(row) => row.clinicId}
          ariaLabel="Clínicas da plataforma"
        />
      ) : null}

      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !pendingAction) {
            setTarget(null);
            setMode(null);
            setReason("");
            setActionError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mode === "suspend" ? "Suspender esta clínica?" : "Reativar esta clínica?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "suspend" ? (
                <>
                  Nenhum dado será apagado. Profissionais e pacientes perderão o acesso operacional
                  enquanto a clínica estiver suspensa. Ela pode ser reativada depois.
                </>
              ) : (
                <>
                  A clínica volta a operar com a mesma equipe, os mesmos vínculos e os mesmos
                  dados. Estados internos (profissional inativo, vínculo encerrado) não mudam.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="clinic-lifecycle-reason">
              {mode === "suspend" ? "Motivo (obrigatório)" : "Motivo (opcional)"}
            </Label>
            <Textarea
              id="clinic-lifecycle-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              disabled={pendingAction}
            />
          </div>
          {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingAction}>Cancelar</AlertDialogCancel>
            <Button onClick={() => void confirmAction()} disabled={pendingAction || !reasonOk}>
              {pendingAction ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {mode === "suspend" ? "Suspender" : "Reativar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={reissueTarget !== null}
        onOpenChange={(open) => {
          if (!open && !reissue.isPending) {
            setReissueTarget(null);
            setReissueError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gerar nova autorização Pix Automático?</AlertDialogTitle>
            <AlertDialogDescription>
              Uma nova tentativa de autorização será criada. A tentativa recusada continuará
              preservada no histórico. Esta ação não realiza uma cobrança. Esta ação não gera o QR
              automaticamente. Após criar a nova tentativa, a etapa normal de criação da autorização
              deverá ser executada separadamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {reissueError ? <p className="text-sm text-destructive">{reissueError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reissue.isPending}>Cancelar</AlertDialogCancel>
            <Button onClick={() => void confirmReissue()} disabled={reissue.isPending}>
              {reissue.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Gerar nova autorização
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
