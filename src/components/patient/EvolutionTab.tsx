import { ExportEvolutionButton } from "./ExportEvolutionButton";
import { PhotosSection } from "./PhotosSection";
import { Card, CardContent } from "@/components/ui/card";
import { useLatestWeight } from "@/hooks/useBodyAssessments";
import { formatWeight, formatWeightDelta } from "@/lib/domain/format";
import type { PatientDetail } from "@/types/db";

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Evolução visual do paciente: resumo de peso (início → atual → meta) + galeria de
 * fotos por posição. O paciente envia pelo app; o profissional também pode adicionar fotos antigas
 * (data retroativa) e classificar a posição. Bucket privado + signed URL.
 */
export function EvolutionTab({ patient }: { patient: PatientDetail }) {
  const { start, current, delta } = useLatestWeight(patient);
  const target = patient.target_weight ?? null;
  const deltaLabel = formatWeightDelta(delta);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Evolução do paciente</h2>
          <p className="text-sm text-muted-foreground">
            Relatório com KPIs, gráfico de peso, antropometria e fotos comparativas.
          </p>
        </div>
        <ExportEvolutionButton patient={patient} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard label="Peso inicial" value={formatWeight(start)} />
        <SummaryCard label="Peso atual" value={formatWeight(current)} />
        <SummaryCard label="Meta" value={formatWeight(target)} />
        <SummaryCard label="Variação" value={deltaLabel} />
      </div>

      <PhotosSection patientId={patient.id} />
    </div>
  );
}
