import { ImageIcon } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProgressPhotos } from "@/hooks/useBodyAssessments";
import { formatDate, formatWeight } from "@/lib/domain/format";
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
 * fotos comparativas. As fotos são enviadas pelo paciente no app (progress_photos);
 * a web só LÊ. Bucket público na sprint — privado + signed URL é dívida (#12/Sessão 8).
 */
export function EvolutionTab({ patient }: { patient: PatientDetail }) {
  const photos = useProgressPhotos(patient.id);

  const start = patient.start_weight ?? null;
  const current = patient.current_weight ?? null;
  const target = patient.target_weight ?? null;
  const delta = start != null && current != null ? current - start : null;
  const deltaLabel =
    delta == null
      ? "—"
      : `${delta > 0 ? "+" : ""}${delta.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard label="Peso inicial" value={formatWeight(start)} />
        <SummaryCard label="Peso atual" value={formatWeight(current)} />
        <SummaryCard label="Meta" value={formatWeight(target)} />
        <SummaryCard label="Variação" value={deltaLabel} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fotos comparativas</CardTitle>
        </CardHeader>
        <CardContent>
          <AsyncSection
            isLoading={photos.isLoading}
            isError={photos.isError}
            isEmpty={!photos.data || photos.data.length === 0}
            onRetry={() => photos.refetch()}
            emptyIcon={ImageIcon}
            emptyTitle="Sem fotos de progresso"
            emptyDescription="As fotos enviadas pelo paciente no app aparecerão aqui, mês a mês."
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {(photos.data ?? []).map((p) => (
                <figure key={p.id} className="space-y-1">
                  <img
                    src={p.photo_url}
                    alt={`Foto de progresso de ${formatDate(p.taken_at)}`}
                    loading="lazy"
                    className="aspect-[3/4] w-full rounded-md bg-muted object-cover"
                  />
                  <figcaption className="text-xs text-muted-foreground">{formatDate(p.taken_at)}</figcaption>
                </figure>
              ))}
            </div>
          </AsyncSection>
        </CardContent>
      </Card>
    </div>
  );
}
