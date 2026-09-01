import { useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/DataTable";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import {
  useApproveClinicCreationRequest,
  usePlatformClinicRequests,
  useRejectClinicCreationRequest,
} from "@/hooks/usePlatformOnboarding";
import type { PlatformClinicRequest } from "@/lib/api/platformAdmin";
import { onboardingErrorMessage } from "@/lib/domain/clinicOnboarding";
import { formatDate } from "@/lib/domain/format";

const STATUS_LABEL: Record<PlatformClinicRequest["status"], string> = {
  pending: "Pendente",
  approved: "Aprovada",
  rejected: "Recusada",
};

export function PlatformRequestsPage() {
  const access = useAmIPlatformAdmin(true);
  const list = usePlatformClinicRequests(access.isPlatformAdmin === true);
  const approve = useApproveClinicCreationRequest();
  const reject = useRejectClinicCreationRequest();
  const [approveId, setApproveId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PlatformClinicRequest | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const pendingAction = approve.isPending || reject.isPending;

  const columns: Column<PlatformClinicRequest>[] = [
    {
      key: "name",
      header: "Nome solicitado",
      render: (row) => <span className="font-medium text-foreground">{row.requestedClinicName}</span>,
    },
    {
      key: "owner",
      header: "Responsável",
      render: (row) => row.requesterName ?? "—",
    },
    {
      key: "email",
      header: "E-mail",
      render: (row) => row.requesterEmail ?? "—",
    },
    {
      key: "date",
      header: "Data",
      render: (row) => formatDate(row.requestedAt),
      className: "text-muted-foreground",
    },
    {
      key: "status",
      header: "Status",
      render: (row) => STATUS_LABEL[row.status],
    },
    {
      key: "actions",
      header: <span className="sr-only">Ações</span>,
      render: (row) =>
        row.status === "pending" ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                setActionError(null);
                setApproveId(row.requestId);
              }}
              disabled={pendingAction}
            >
              Aprovar
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setActionError(null);
                setReason("");
                setRejectTarget(row);
              }}
              disabled={pendingAction}
            >
              Recusar
            </Button>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Solicitações"
        description="Pedidos de criação de clínica. Sem dados clínicos individuais."
      />

      {list.isLoading ? <Skeleton className="h-64 w-full" /> : null}

      {list.isError ? (
        <ErrorState
          title="Não foi possível carregar as solicitações"
          description="Tente novamente. A fila não usa o status pending do perfil."
          onRetry={() => void list.refetch()}
        />
      ) : null}

      {actionError ? (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      {!list.isLoading && !list.isError && (list.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nenhuma solicitação"
          description="Quando alguém pedir para criar uma clínica, o pedido aparece aqui."
        />
      ) : null}

      {!list.isLoading && !list.isError && (list.data?.length ?? 0) > 0 ? (
        <DataTable
          columns={columns}
          rows={list.data ?? []}
          getRowId={(row) => row.requestId}
          ariaLabel="Solicitações de criação de clínica"
        />
      ) : null}

      <AlertDialog open={approveId !== null} onOpenChange={(open) => !open && setApproveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar criação de clínica?</AlertDialogTitle>
            <AlertDialogDescription>
              A pessoa poderá concluir a criação com o nome que enviou. Isso não cria a clínica agora.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approve.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={approve.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!approveId) return;
                approve.mutate(approveId, {
                  onSuccess: () => setApproveId(null),
                  onError: (err) => setActionError(onboardingErrorMessage(err)),
                });
              }}
            >
              {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Aprovar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recusar solicitação?</AlertDialogTitle>
            <AlertDialogDescription>
              O motivo é opcional e aparece para quem pediu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Motivo (opcional)</Label>
            <Input
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reject.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={reject.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!rejectTarget) return;
                reject.mutate(
                  { requestId: rejectTarget.requestId, reason: reason.trim() || undefined },
                  {
                    onSuccess: () => setRejectTarget(null),
                    onError: (err) => setActionError(onboardingErrorMessage(err)),
                  },
                );
              }}
            >
              {reject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Recusar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
