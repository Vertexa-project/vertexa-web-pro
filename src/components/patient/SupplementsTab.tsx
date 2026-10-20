import { useState } from "react";
import { Bell, Pencil, Pill, Plus, Trash2 } from "lucide-react";

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
import { useDisciplinePermissions } from "@/hooks/useDisciplines";
import { DISCIPLINE_REASON } from "@/lib/domain/disciplines";
import { KIND_LABEL, reminderToInput, type SupplementKind } from "@/lib/domain/supplementForm";
import type { PatientDetail, Supplement } from "@/types/db";

/**
 * Editor de suplementos e medicamentos do paciente (autoria da web; o app LÊ a lista). CRUD por linha:
 * adicionar/editar via diálogo, excluir via AlertDialog (design system, não window.confirm — #19c).
 * RBAC via GatedAction (médico/nutri editam; os demais veem read-only). NÃO renderiza o "tomado"
 * (estado do paciente/app). loading/empty/erro via AsyncSection.
 */
export function SupplementsTab({ patient }: { patient: PatientDetail }) {
  const { data, isLoading, isError, refetch } = usePatientSupplements(patient.id);
  const { perms } = useDisciplinePermissions();
  const canEditSupp = perms.canEditSupplements;
  const canEditMed = perms.canEditMedications;
  const canEditKind = (k: SupplementKind) => (k === "medication" ? canEditMed : canEditSupp);
  const del = useDeleteSupplement(patient.id);

  const [editing, setEditing] = useState<{ open: boolean; supplement: Supplement | null; kind: SupplementKind }>({
    open: false,
    supplement: null,
    kind: "supplement",
  });
  const [pendingDelete, setPendingDelete] = useState<Supplement | null>(null);

  const openCreate = (kind: SupplementKind) => setEditing({ open: true, supplement: null, kind });
  const openEdit = (supplement: Supplement) => setEditing({ open: true, supplement, kind: supplement.kind ?? "supplement" });

  function confirmDelete() {
    if (!pendingDelete) return;
    del.mutate({ id: pendingDelete.id, kind: pendingDelete.kind }, { onSettled: () => setPendingDelete(null) });
  }

  const groups: Array<{ kind: SupplementKind; title: string; items: Supplement[] }> = [
    { kind: "supplement", title: "Suplementos", items: (data ?? []).filter((x) => (x.kind ?? "supplement") === "supplement") },
    { kind: "medication", title: "Medicamentos", items: (data ?? []).filter((x) => x.kind === "medication") },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Suplementos e medicamentos</h2>
          <p className="text-sm text-muted-foreground">
            Lista que o paciente vê no app, com lembrete no horário definido. O “tomado” é registrado por ele.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <GatedAction canEdit={canEditSupp} reason={DISCIPLINE_REASON.supplements} wrapperClassName="items-end" size="sm" onClick={() => openCreate("supplement")}>
            <Plus className="h-4 w-4" />
            Suplemento
          </GatedAction>
          <GatedAction canEdit={canEditMed} reason={DISCIPLINE_REASON.medications} wrapperClassName="items-end" size="sm" variant="outline" onClick={() => openCreate("medication")}>
            <Plus className="h-4 w-4" />
            Medicamento
          </GatedAction>
        </div>
      </div>

      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        isEmpty={!data || data.length === 0}
        onRetry={() => refetch()}
        emptyIcon={Pill}
        emptyTitle="Nenhum suplemento ou medicamento"
        emptyDescription="Adicione os itens do paciente — eles aparecem no app com lembrete."
      >
        <div className="space-y-6">
          {groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <section key={g.kind} aria-label={g.title} className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">{g.title}</h3>
                {g.items.map((s) => (
                  <Card key={s.id}>
                    <CardContent className="flex items-center justify-between gap-4 p-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-medium text-foreground">{s.name}</h3>
                          {s.dose ? (
                            <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{s.dose}</span>
                          ) : null}
                          {s.brand ? <span className="shrink-0 text-xs text-muted-foreground">Marca: {s.brand}</span> : null}
                        </div>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                          {s.time_label ? <span>{s.time_label}</span> : null}
                          {s.reminder_time ? (
                            <span className="inline-flex items-center gap-1">
                              <Bell className="h-3 w-3" aria-hidden /> Lembrete {reminderToInput(s.reminder_time)}
                            </span>
                          ) : null}
                        </p>
                        {s.notes ? <p className="mt-1 text-xs text-muted-foreground">{s.notes}</p> : null}
                      </div>
                      {canEditKind(g.kind) ? (
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
              </section>
            ))}
        </div>
      </AsyncSection>

      <SupplementEditorDialog
        patientId={patient.id}
        existing={editing.supplement}
        kind={editing.kind}
        open={editing.open}
        onOpenChange={(open) => setEditing((s) => ({ ...s, open }))}
      />

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => (!open ? setPendingDelete(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {pendingDelete?.kind === "medication" ? KIND_LABEL.medication.toLowerCase() : KIND_LABEL.supplement.toLowerCase()}?</AlertDialogTitle>
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
