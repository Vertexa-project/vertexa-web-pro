import { useState } from "react";
import { Pencil, Pill, Plus, Trash2 } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { GatedAction } from "./GatedAction";
import { SupplementEditorDialog } from "./SupplementEditorDialog";
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
import { Card, CardContent } from "@/components/ui/card";
import { useDeleteSupplement, usePatientSupplements } from "@/hooks/useSupplements";
import { EDIT_REASON } from "@/lib/domain/roles";
import { useRole } from "@/providers/role-context";
import type { PatientDetail, Supplement } from "@/types/db";

/**
 * Editor de suplementos do paciente (autoria da web; o app LÊ a lista). CRUD por linha:
 * adicionar/editar via diálogo, excluir via AlertDialog (design system, não window.confirm — #19c).
 * RBAC via GatedAction (médico/nutri editam; os demais veem read-only). NÃO renderiza o "tomado"
 * (estado do paciente/app). loading/empty/erro via AsyncSection.
 */
export function SupplementsTab({ patient }: { patient: PatientDetail }) {
  const { data, isLoading, isError, refetch } = usePatientSupplements(patient.id);
  const { perms } = useRole();
  const canEdit = perms.canEditSupplements;
  const del = useDeleteSupplement(patient.id);

  const [editing, setEditing] = useState<{ open: boolean; supplement: Supplement | null }>({
    open: false,
    supplement: null,
  });
  const [pendingDelete, setPendingDelete] = useState<Supplement | null>(null);

  const openCreate = () => setEditing({ open: true, supplement: null });
  const openEdit = (supplement: Supplement) => setEditing({ open: true, supplement });

  function confirmDelete() {
    if (!pendingDelete) return;
    del.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Suplementos</h2>
          <p className="text-sm text-muted-foreground">
            Lista que o paciente vê no app. O “tomado” é registrado por ele.
          </p>
        </div>
        <GatedAction
          canEdit={canEdit}
          reason={EDIT_REASON.supplements}
          wrapperClassName="items-end"
          size="sm"
          onClick={openCreate}
        >
          <Plus className="h-4 w-4" />
          Adicionar
        </GatedAction>
      </div>

      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        isEmpty={!data || data.length === 0}
        onRetry={() => refetch()}
        emptyIcon={Pill}
        emptyTitle="Nenhum suplemento"
        emptyDescription="Adicione os suplementos do paciente — eles aparecem no app."
        emptyAction={
          <GatedAction
            canEdit={canEdit}
            reason={EDIT_REASON.supplements}
            wrapperClassName="items-center"
            onClick={openCreate}
          >
            <Plus className="h-4 w-4" />
            Adicionar suplemento
          </GatedAction>
        }
      >
        <div className="space-y-3">
          {(data ?? []).map((s) => (
            <Card key={s.id}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-medium text-foreground">{s.name}</h3>
                    {s.dose ? (
                      <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {s.dose}
                      </span>
                    ) : null}
                  </div>
                  {s.time_label ? <p className="mt-0.5 text-xs text-muted-foreground">{s.time_label}</p> : null}
                </div>
                {/* Ações por linha só para quem edita; o gate/motivo já aparece no botão "Adicionar". */}
                {canEdit ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Editar ${s.name}`} onClick={() => openEdit(s)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Excluir ${s.name}`}
                      onClick={() => setPendingDelete(s)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </AsyncSection>

      <SupplementEditorDialog
        patientId={patient.id}
        existing={editing.supplement}
        open={editing.open}
        onOpenChange={(open) => setEditing((s) => ({ ...s, open }))}
      />

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => (!open ? setPendingDelete(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir suplemento?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `“${pendingDelete.name}” será removido da lista do paciente no app. Esta ação não pode ser desfeita.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              // preventDefault: não fechar no clique — fechamos via onSettled após a exclusão.
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={del.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {del.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
