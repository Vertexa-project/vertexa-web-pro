import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSetBilling } from "@/hooks/useFinance";
import { centsToInput, validateBilling, type FinancePatient } from "@/lib/domain/finance";

interface Props { patient: FinancePatient | null; open: boolean; onOpenChange: (o: boolean) => void }

/** Define o valor mensal e o dia de vencimento de UM paciente (só administrador). */
export function BillingDialog({ patient, open, onOpenChange }: Props) {
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("10");
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const save = useSetBilling();

  useEffect(() => {
    if (!open || !patient) return;
    setError(null);
    setAmount(centsToInput(patient.monthly_amount_cents));
    setDay(String(patient.due_day ?? 10));
    setActive(patient.is_active ?? true);
  }, [open, patient]);

  function submit() {
    if (!patient) return;
    const v = validateBilling(amount, day);
    if (!v.ok) return setError(v.error);
    save.mutate({ patientId: patient.patient_id, amountCents: v.value.amountCents, dueDay: v.value.dueDay, active }, {
      onSuccess: () => onOpenChange(false),
      onError: () => setError("Não foi possível salvar. Só o administrador da clínica altera valores."),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Valor de {patient?.full_name ?? "paciente"}</DialogTitle>
          <DialogDescription>Cobranças ainda pendentes do mês atual em diante passam a usar o novo valor. As já pagas não mudam.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fin-amount">Valor mensal (R$)</Label>
            <Input id="fin-amount" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="250,00" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fin-day">Dia do vencimento (1 a 28)</Label>
            <Input id="fin-day" inputMode="numeric" className="w-24" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Gerar cobrança todo mês
          </label>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancelar</Button>
          <Button onClick={submit} disabled={save.isPending} aria-busy={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
