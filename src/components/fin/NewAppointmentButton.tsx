import { Link } from "react-router-dom";
import { Stethoscope } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useFinContext } from "@/hooks/useFin";
import { canStartAppointment } from "@/lib/domain/finAccess";

/** Botão «Novo atendimento» da ficha do paciente (mudança mínima na ficha). Só para Admin/Gestor ou profissional ativo; abre Financeiro › Atendimentos já com o paciente. */
export function NewAppointmentButton({ patientId, patientName }: { patientId: string; patientName: string }) {
  const { access } = useFinContext();
  if (!canStartAppointment(access)) return null;
  const qs = new URLSearchParams({ novo: "1", paciente: patientId, nome: patientName });
  return (
    <Button asChild variant="outline">
      <Link to={`/financeiro/atendimentos?${qs.toString()}`}><Stethoscope className="h-4 w-4" aria-hidden /> Novo atendimento</Link>
    </Button>
  );
}
