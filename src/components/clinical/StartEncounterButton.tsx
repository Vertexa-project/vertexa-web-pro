import { useState } from "react";
import { Loader2, Mic } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { clinicalErrorMessage, startEncounter } from "@/lib/api/clinical";

/** "Iniciar atendimento": cria o atendimento e abre a tela de gravação/prontuário. */
export function StartEncounterButton({ patientId, variant = "default" }: { patientId: string; variant?: "default" | "outline" }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setBusy(true);
    setError(null);
    try {
      navigate(`/pacientes/${patientId}/atendimento/${await startEncounter(patientId)}`);
    } catch (e) {
      setError(clinicalErrorMessage(e));
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant={variant} onClick={() => void start()} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />} Iniciar atendimento
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      ) : null}
    </>
  );
}
