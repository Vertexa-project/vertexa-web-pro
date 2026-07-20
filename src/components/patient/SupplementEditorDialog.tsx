import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateSupplement, useUpdateSupplement } from "@/hooks/useSupplements";
import { useDisciplinePermissions } from "@/hooks/useDisciplines";
import { DISCIPLINE_REASON, isDisciplineDenied, writeDeniedMessage } from "@/lib/domain/disciplines";
import { captureException } from "@/lib/observability/sentry";
import type { Supplement } from "@/types/db";

interface Props {
  patientId: string;
  existing: Supplement | null; // null = criar
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Cria/edita UM suplemento (campos name/dose/time_label). O paciente vê a lista no app. */
export function SupplementEditorDialog({ patientId, existing, open, onOpenChange }: Props) {
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [timeLabel, setTimeLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useCreateSupplement(patientId);
  const update = useUpdateSupplement(patientId);
  const pending = create.isPending || update.isPending;
  const { perms } = useDisciplinePermissions();
  const canEdit = perms.canEditSupplements;

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? "");
      setDose(existing?.dose ?? "");
      setTimeLabel(existing?.time_label ?? "");
      setError(null);
    }
  }, [open, existing]);

  function handleSave() {
    if (!canEdit) {
      setError(DISCIPLINE_REASON.supplements);
      return;
    }
    if (!name.trim()) {
      setError("Informe o nome do suplemento.");
      return;
    }
    const onSuccess = () => onOpenChange(false);
    const onError = (err: unknown) => {
      if (isDisciplineDenied(err)) {
        captureException(err, { source: "authz", scope: "supplements" });
        setError(writeDeniedMessage(err, "supplements"));
      } else {
        setError("Não foi possível salvar. Tente novamente.");
      }
    };
    if (existing) {
      update.mutate({ id: existing.id, name, dose, timeLabel }, { onSuccess, onError });
    } else {
      create.mutate({ patientId, name, dose, timeLabel }, { onSuccess, onError });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Editar suplemento" : "Novo suplemento"}</DialogTitle>
          <DialogDescription>O paciente vê esta lista no app; o “tomado” é registrado por ele.</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sup-name">Nome</Label>
            <Input
              id="sup-name"
              autoFocus
              value={name}
              aria-invalid={Boolean(error) && !name.trim()}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Creatina"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sup-dose">Dose</Label>
              <Input id="sup-dose" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="Ex.: 5 g" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sup-time">Momento</Label>
              <Input
                id="sup-time"
                value={timeLabel}
                onChange={(e) => setTimeLabel(e.target.value)}
                placeholder="Ex.: Pós-treino"
              />
            </div>
          </div>
          {!canEdit ? (
            <p className="text-sm text-muted-foreground" role="note">
              {DISCIPLINE_REASON.supplements}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!canEdit || pending} aria-busy={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {pending ? "Salvando…" : existing ? "Salvar" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
