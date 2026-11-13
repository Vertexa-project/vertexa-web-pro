// Estorno de movimentação ou de entrada inteira: motivo obrigatório; nada é apagado (a linha original fica, com a marca de estornada).
import { useState } from "react";

import { Field, FormDialog } from "@/components/fin/FinUi";
import { Input } from "@/components/ui/input";
import { useReverseEntry, useReverseMovement } from "@/hooks/useStockMoves";
import { stockMoveErrorMessage } from "@/lib/domain/stockMoves";

export type ReverseTarget = { kind: "movement"; id: string; label: string } | { kind: "entry"; id: string; label: string };

export function ReverseDialog({ target, onClose }: { target: ReverseTarget | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const reverseMovement = useReverseMovement();
  const reverseEntry = useReverseEntry();
  const pending = reverseMovement.isPending || reverseEntry.isPending;

  function submit() {
    if (!target) return;
    if (reason.trim().length < 3) { setFieldError("Informe o motivo do estorno."); setError(null); return; }
    setFieldError(null);
    setError(null);
    const opts = { onSuccess: onClose, onError: (e: unknown) => setError(stockMoveErrorMessage(e)) };
    if (target.kind === "movement") reverseMovement.mutate({ movementId: target.id, reason: reason.trim() }, opts);
    else reverseEntry.mutate({ entryId: target.id, reason: reason.trim() }, opts);
  }

  return (
    <FormDialog
      open={target !== null} onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={target?.kind === "entry" ? "Estornar entrada" : "Estornar movimentação"}
      description={target ? `${target.label}. O lançamento original fica no histórico; o estorno devolve o saldo e o custo.` : undefined}
      onSubmit={submit} pending={pending} error={error} submitLabel="Estornar"
    >
      <Field label="Motivo do estorno" htmlFor="rev-reason" error={fieldError} hint="Fica registrado no Histórico, com quem fez e quando.">
        <Input id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus />
      </Field>
    </FormDialog>
  );
}
