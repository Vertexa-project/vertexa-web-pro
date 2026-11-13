// Motivo obrigatório (cancelar atendimento, trocar participantes de atendimento realizado, resolver consumo sem saldo, devolução): vai para o Histórico.
import { useState } from "react";

import { Field, FormDialog } from "@/components/fin/FinUi";
import { Input } from "@/components/ui/input";

export function ReasonDialog({ title, description, label = "Motivo", submitLabel, pending, error, onSubmit, onClose, children }: {
  title: string; description?: string; label?: string; submitLabel: string; pending: boolean; error: string | null; onSubmit: (reason: string) => void; onClose: () => void; children?: React.ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={title} description={description} submitLabel={submitLabel} pending={pending} error={error}
      onSubmit={() => { if (reason.trim().length < 3) return setFieldError("Informe o motivo (mínimo 3 letras)."); setFieldError(null); onSubmit(reason.trim()); }}>
      {children}
      <Field label={label} htmlFor="reason-text" error={fieldError} hint="Fica registrado no Histórico, com quem fez e quando.">
        <Input id="reason-text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus />
      </Field>
    </FormDialog>
  );
}
