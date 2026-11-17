import { HeartHandshake } from "lucide-react";

import { usePatientReengagementLine } from "@/hooks/useReengagement";
import { lineText } from "@/lib/domain/reengagement";

/** Ficha (Resumo › Sinais recentes): "Reengajamento: mensagem 2 de 3 enviada em dd/mm". Some quando nunca houve envio ou sem permissão. */
export function ReengagementLine({ patientId }: { patientId: string }) {
  const { data } = usePatientReengagementLine(patientId);
  if (!data) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <HeartHandshake className="h-4 w-4 shrink-0 text-primary-ink" aria-hidden />
      <span className="text-foreground">Reengajamento: {lineText(data)}</span>
    </div>
  );
}
