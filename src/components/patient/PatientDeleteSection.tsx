import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDeleteUnusedPatientRegistration, usePatientDeletionEligibility } from "@/hooks/usePatients";
import {
  PATIENT_DELETE_CONFIRM_WORD,
  isPatientDeleteConfirmed,
  patientDeleteErrorMessage,
  resolvePatientDeleteUi,
} from "@/lib/domain/patientDeletion";

interface Props {
  patientId: string;
  patientName: string;
  /** Consulta a elegibilidade só enquanto o "Editar cadastro" está aberto. */
  enabled: boolean;
  /** Avisa o pai para fechar o diálogo/navegar (o cache já foi atualizado pelo hook). */
  onDeleted: () => void;
  /** Avisa o pai que há exclusão em andamento (o diálogo não pode fechar no meio). */
  onPendingChange?: (pending: boolean) => void;
}

/**
 * Zona destrutiva do "Editar cadastro" (WP-PATIENT-DIAG-DELETE-01). Só é montada para admin da
 * clínica do paciente; o servidor revalida tudo. Sem clique único: exige digitar EXCLUIR.
 */
export function PatientDeleteSection({ patientId, patientName, enabled, onDeleted, onPendingChange }: Props) {
  const eligibilityQ = usePatientDeletionEligibility(patientId, enabled);
  const del = useDeleteUnusedPatientRegistration();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const ui = resolvePatientDeleteUi({
    data: eligibilityQ.data,
    isLoading: eligibilityQ.isLoading,
    isError: eligibilityQ.isError,
  });

  useEffect(() => {
    onPendingChange?.(del.isPending);
  }, [del.isPending, onPendingChange]);

  function openConfirm() {
    setTyped("");
    del.reset();
    setConfirmOpen(true);
  }

  function handleDelete() {
    if (del.isPending || !isPatientDeleteConfirmed(typed)) return;
    del.mutate(patientId, {
      onSuccess: () => {
        setConfirmOpen(false);
        onDeleted();
      },
    });
  }

  return (
    <section aria-labelledby="pd-title" className="space-y-3 rounded-md border border-destructive/40 p-4">
      <div className="space-y-1">
        <h3 id="pd-title" className="text-sm font-semibold text-destructive">
          Excluir cadastro
        </h3>
        <p className="text-xs text-muted-foreground">
          Disponível apenas para cadastros que ainda não possuem acesso ou movimentação na plataforma.
        </p>
      </div>

      {ui.kind === "blocked" ? (
        <p id="pd-blocked" className="text-sm text-muted-foreground">
          {ui.message}
        </p>
      ) : null}

      <Button
        type="button"
        variant="destructive"
        onClick={openConfirm}
        disabled={ui.kind !== "eligible" || del.isPending}
        aria-describedby={ui.kind === "blocked" ? "pd-blocked" : undefined}
      >
        {ui.kind === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden />
        )}
        {ui.kind === "loading" ? "Verificando…" : "Excluir cadastro"}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => (del.isPending ? undefined : setConfirmOpen(o))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o cadastro de {patientName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso remove definitivamente este cadastro não utilizado. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="pd-confirm">
              Digite <span className="font-semibold">{PATIENT_DELETE_CONFIRM_WORD}</span> para confirmar
            </Label>
            <Input
              id="pd-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              disabled={del.isPending}
            />
          </div>

          {del.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {patientDeleteErrorMessage(del.error)}
            </p>
          ) : null}

          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={del.isPending}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={del.isPending || !isPatientDeleteConfirmed(typed)}
            >
              {del.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Excluindo…
                </>
              ) : (
                "Excluir definitivamente"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
