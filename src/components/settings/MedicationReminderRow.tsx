// Configurações → lembrete da aplicação de medicação no app do paciente (A3). Só admin; nasce DESLIGADO.
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useMedSettings, useSetMedSettings } from "@/hooks/useMedication";

export function MedicationReminderRow({ clinicId }: { clinicId: string | null }) {
  const q = useMedSettings(clinicId);
  const set = useSetMedSettings(clinicId);
  const [error, setError] = useState<string | null>(null);
  const on = q.data === true;
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{q.isLoading ? "…" : on ? "Ligado" : "Desligado"}</span>
        <Button
          size="sm" variant="outline" role="switch" aria-checked={on} aria-label="Lembrete de aplicação de medicação no app do paciente"
          disabled={q.isLoading || q.isError || set.isPending}
          onClick={() => { setError(null); set.mutate(!on, { onError: () => setError("Não foi possível salvar. Tente novamente.") }); }}
        >
          {set.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {on ? "Desligar" : "Ligar"}
        </Button>
      </div>
      <p className="max-w-xs text-xs text-muted-foreground">No dia da aplicação, o paciente vê um cartão no Início com o botão “Já apliquei”.</p>
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
