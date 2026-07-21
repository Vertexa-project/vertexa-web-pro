import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, KanbanSquare, Loader2, Pencil, Plus, ShieldAlert, Star, Trash2 } from "lucide-react";

import { AsyncSection } from "@/components/patient/AsyncSection";
import { ColumnFormDialog, type ColumnFormValues } from "@/components/journey/ColumnFormDialog";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import {
  useCreateJourneyColumn,
  useDeleteJourneyColumn,
  useJourneyColumns,
  useJourneyState,
  useSetInitialColumn,
  useSwapColumns,
  useUpdateJourneyColumn,
} from "@/hooks/useJourney";
import { sortColumns, type JourneyColumn } from "@/lib/domain/journeyBoard";
import { isColumnInUse } from "@/lib/domain/journeyErrors";
import { captureException } from "@/lib/observability/sentry";

type DialogState = { mode: "create" } | { mode: "edit"; column: JourneyColumn } | null;

export function JourneyColumnsAdminPage() {
  const { data: me } = useCurrentProfessional();
  const clinicId = me?.clinicId ?? null;
  const { isClinicAdmin, isLoading: adminLoading } = useIsClinicAdmin(clinicId);

  const columnsQ = useJourneyColumns(clinicId);
  const stateQ = useJourneyState(Boolean(clinicId));
  const create = useCreateJourneyColumn(clinicId);
  const update = useUpdateJourneyColumn(clinicId);
  const remove = useDeleteJourneyColumn(clinicId);
  const setInitial = useSetInitialColumn(clinicId);
  const swap = useSwapColumns(clinicId);

  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleteTarget, setDeleteTarget] = useState<JourneyColumn | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const columns = useMemo(() => sortColumns(columnsQ.data ?? []), [columnsQ.data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const colId of Object.values(stateQ.data ?? {})) c[colId] = (c[colId] ?? 0) + 1;
    return c;
  }, [stateQ.data]);

  const structuralBusy = swap.isPending || setInitial.isPending || remove.isPending;

  if (adminLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Colunas da jornada" />
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
            Verificando suas permissões…
          </CardContent>
        </Card>
      </div>
    );
  }

  // Fail-closed: só o admin da clínica administra as colunas (o banco também nega — is_clinic_admin).
  if (!isClinicAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Colunas da jornada" />
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />
            Apenas o administrador da clínica configura as colunas da jornada.
          </CardContent>
        </Card>
      </div>
    );
  }

  const nextPosition = columns.length ? Math.max(...columns.map((c) => c.position)) + 1 : 1;

  /** Motivo (se houver) para BLOQUEAR a remoção — regra de UI antes do banco recusar por FK. */
  function deleteBlockReason(col: JourneyColumn): string | null {
    if (col.is_initial) return "É a coluna inicial — defina outra como inicial antes de remover.";
    const n = counts[col.id] ?? 0;
    if (n > 0) return `Tem ${n} paciente(s) nesta coluna — mova-os antes de remover.`;
    return null;
  }

  function handleCreate(values: ColumnFormValues) {
    setNotice(null);
    create.mutate(
      { clinicId: clinicId as string, name: values.name, color: values.color, position: nextPosition },
      {
        onSuccess: () => setDialog(null),
        onError: (err) => {
          captureException(err, { source: "journey", scope: "column-create" });
          setNotice("Não foi possível criar a coluna.");
        },
      },
    );
  }

  function handleEdit(column: JourneyColumn, values: ColumnFormValues) {
    setNotice(null);
    update.mutate(
      { id: column.id, patch: { name: values.name, color: values.color } },
      {
        onSuccess: () => setDialog(null),
        onError: (err) => {
          captureException(err, { source: "journey", scope: "column-update" });
          setNotice("Não foi possível salvar a coluna.");
        },
      },
    );
  }

  function handleSetInitial(column: JourneyColumn) {
    setNotice(null);
    setInitial.mutate(column.id, {
      onError: (err) => {
        captureException(err, { source: "journey", scope: "column-initial" });
        setNotice("Não foi possível definir a coluna inicial.");
      },
    });
  }

  function handleSwap(a: JourneyColumn, b: JourneyColumn) {
    setNotice(null);
    swap.mutate({ a, b });
  }

  function confirmDelete() {
    const col = deleteTarget;
    if (!col) return;
    remove.mutate(col.id, {
      onSuccess: () => setDeleteTarget(null),
      onError: (err) => {
        setDeleteTarget(null);
        if (isColumnInUse(err)) {
          setNotice(
            "Esta coluna tem histórico de movimentações (imutável, por auditoria) e não pode ser removida. Mantenha-a ou renomeie-a.",
          );
        } else {
          captureException(err, { source: "journey", scope: "column-delete" });
          setNotice("Não foi possível remover a coluna.");
        }
      },
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Colunas da jornada"
        description="Crie, renomeie, reordene e defina a coluna inicial. Uma única coluna inicial é garantida pelo banco. Colunas com pacientes ou histórico não podem ser removidas."
        actions={
          <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
            <Plus className="h-4 w-4" /> Nova coluna
          </Button>
        }
      />

      {notice ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {notice}
        </p>
      ) : null}

      <AsyncSection
        isLoading={columnsQ.isLoading}
        isError={columnsQ.isError}
        isEmpty={columns.length === 0}
        onRetry={() => columnsQ.refetch()}
        emptyIcon={KanbanSquare}
        emptyTitle="Nenhuma coluna ainda"
        emptyDescription="Crie a primeira coluna da jornada."
        emptyAction={
          <Button size="sm" onClick={() => setDialog({ mode: "create" })}>
            <Plus className="h-4 w-4" /> Nova coluna
          </Button>
        }
      >
        <div className="space-y-2">
          {columns.map((col, i) => {
            const blockReason = deleteBlockReason(col);
            const count = counts[col.id] ?? 0;
            return (
              <Card key={col.id}>
                <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex flex-col">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label={`Mover ${col.name} para cima`}
                        disabled={i === 0 || structuralBusy}
                        onClick={() => handleSwap(col, columns[i - 1])}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label={`Mover ${col.name} para baixo`}
                        disabled={i === columns.length - 1 || structuralBusy}
                        onClick={() => handleSwap(col, columns[i + 1])}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full border"
                      style={{ backgroundColor: col.color ?? "transparent" }}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate font-medium text-foreground">
                        {col.name}
                        {col.is_initial ? <Badge tone="primary">inicial</Badge> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {count} paciente(s) nesta coluna
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={col.is_initial || setInitial.isPending}
                      onClick={() => handleSetInitial(col)}
                    >
                      <Star className="h-4 w-4" /> Tornar inicial
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setDialog({ mode: "edit", column: col })}>
                      <Pencil className="h-4 w-4" /> Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={Boolean(blockReason) || structuralBusy}
                      title={blockReason ?? "Remover coluna"}
                      onClick={() => setDeleteTarget(col)}
                    >
                      <Trash2 className="h-4 w-4" /> Remover
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </AsyncSection>

      <ColumnFormDialog
        open={dialog !== null}
        onOpenChange={(o) => (o ? null : setDialog(null))}
        mode={dialog?.mode ?? "create"}
        initial={
          dialog?.mode === "edit"
            ? { name: dialog.column.name, color: dialog.column.color }
            : undefined
        }
        pending={create.isPending || update.isPending}
        onSubmit={(values) =>
          dialog?.mode === "edit" ? handleEdit(dialog.column, values) : handleCreate(values)
        }
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => (o ? null : setDeleteTarget(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover a coluna "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              A coluna será removida da jornada. Esta ação não pode ser desfeita. Se houver histórico de
              movimentações associado, o banco recusará a remoção (o histórico é imutável, por auditoria).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
