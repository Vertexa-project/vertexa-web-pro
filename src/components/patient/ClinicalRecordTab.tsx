import { useEffect } from "react";
import { FileText } from "lucide-react";
import { Link } from "react-router-dom";

import { StartEncounterButton } from "@/components/clinical/StartEncounterButton";

import { AsyncSection } from "./AsyncSection";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEncounters } from "@/hooks/useClinical";
import { purgeAudio, type EncounterStatus } from "@/lib/api/clinical";
import { formatDateTimeBr } from "@/lib/clinical/display";

const LABEL: Record<EncounterStatus, { label: string; tone: "muted" | "destructive" | "warning" | "success" | "info" }> = {
  rascunho: { label: "Rascunho", tone: "info" },
  gravando: { label: "Gravando", tone: "destructive" },
  processando: { label: "Processando", tone: "warning" },
  finalizado: { label: "Finalizado", tone: "success" },
  cancelado: { label: "Cancelado", tone: "muted" },
};

/** Aba "Prontuário": atendimentos do paciente (só equipe clínica; o servidor nega aos demais). */
export function ClinicalRecordTab({ patientId }: { patientId: string }) {
  const q = useEncounters(patientId);

  // Varredura leve: apaga o áudio dos atendimentos cujo prazo (30 dias) venceu.
  useEffect(() => {
    void purgeAudio({}).catch(() => undefined);
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Prontuário</CardTitle>
        <StartEncounterButton patientId={patientId} />
      </CardHeader>
      <CardContent className="space-y-3">
        <AsyncSection
          isLoading={q.isLoading}
          isError={q.isError}
          isEmpty={(q.data ?? []).length === 0}
          onRetry={() => void q.refetch()}
          emptyTitle="Nenhum atendimento ainda"
          emptyDescription="Use “Iniciar atendimento” para gravar a consulta e preencher o prontuário automaticamente."
        >
          {
            <ul className="divide-y rounded-md border" data-testid="encounter-list">
              {(q.data ?? []).map((e) => (
                <li key={e.id}>
                  <Link to={`/pacientes/${patientId}/atendimento/${e.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 hover:bg-accent">
                    <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="text-sm font-medium">{formatDateTimeBr(e.started_at)}</span>
                    <span className="text-sm text-muted-foreground">{e.professional_name ?? "—"}</span>
                    <Badge tone={LABEL[e.status].tone}>{LABEL[e.status].label}</Badge>
                    {e.is_demo ? <Badge tone="warning">Demonstração</Badge> : null}
                    {e.agreements_sent_at ? <Badge tone="primary">Combinados enviados</Badge> : null}
                  </Link>
                </li>
              ))}
            </ul>
          }
        </AsyncSection>
      </CardContent>
    </Card>
  );
}
