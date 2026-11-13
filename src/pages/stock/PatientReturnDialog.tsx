// Devolução de paciente (escopo-v1 §8.2): o item volta ao estoque no mesmo lote e ao custo da saída original. Origem: venda ou entrega de item de pacote. Parcial permitida.
import { useState } from "react";

import { DecimalInput, Field, FormDialog } from "@/components/fin/FinUi";
import { Input } from "@/components/ui/input";
import { useReturnFromPatient } from "@/hooks/useFinAppointments";
import { apptErrorMessage } from "@/lib/domain/finAppointments";
import { formatQty } from "@/lib/domain/stockMoves";

export interface ReturnTarget { movementId: string; itemName: string; qtyOut: number; stockUnit: string; origin: "Venda" | "Entrega de pacote" }

export function PatientReturnDialog({ target, onClose }: { target: ReturnTarget | null; onClose: () => void }) {
  const [qty, setQty] = useState<number | null>(target ? target.qtyOut : null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ qty?: string; reason?: string }>({});
  const ret = useReturnFromPatient();
  if (!target) return null;
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title="Devolução de paciente" submitLabel="Registrar devolução" pending={ret.isPending} error={error}
      description={`${target.origin}: ${target.itemName}, ${formatQty(target.qtyOut)} ${target.stockUnit}. O item volta ao estoque no mesmo lote e ao custo da saída. O dinheiro devolvido é tratado no financeiro (estorno do recebimento).`}
      onSubmit={() => {
        const e: { qty?: string; reason?: string } = {};
        if (!qty || qty <= 0) e.qty = "Informe a quantidade devolvida.";
        else if (qty > target.qtyOut) e.qty = `Não dá para devolver mais do que saiu (${formatQty(target.qtyOut)}).`;
        if (reason.trim().length < 3) e.reason = "Informe o motivo da devolução.";
        setErrors(e);
        if (e.qty || e.reason) return;
        setError(null);
        ret.mutate({ movementId: target.movementId, qty: qty as number, reason: reason.trim() }, { onSuccess: onClose, onError: (err) => setError(apptErrorMessage(err)) });
      }}>
      <Field label={`Quantidade devolvida (${target.stockUnit})`} htmlFor="ret-qty" error={errors.qty}><DecimalInput id="ret-qty" value={qty} onChange={setQty} maxDecimals={3} /></Field>
      <Field label="Motivo" htmlFor="ret-reason" error={errors.reason} hint="Fica registrado no Histórico, com quem fez e quando."><Input id="ret-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
    </FormDialog>
  );
}
