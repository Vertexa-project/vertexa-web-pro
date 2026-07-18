import { ImageIcon } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { ExportEvolutionButton } from "./ExportEvolutionButton";
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
                  {p.display_url ? (
                    <img
                      src={p.display_url}
                      alt={`Foto de progresso de ${formatDate(p.taken_at)}`}
                      loading="lazy"
                      className="aspect-[3/4] w-full rounded-md bg-muted object-cover"
                    />
                  ) : (
                    // Sem signed URL (linha sem storage_path ou falha ao assinar → já reportada
                    // ao Sentry): placeholder, nunca <img> quebrada.
                    <div
                      role="img"
                      aria-label={`Foto de progresso de ${formatDate(p.taken_at)} indisponível`}
                      className="flex aspect-[3/4] w-full items-center justify-center rounded-md bg-muted text-muted-foreground"
                    >
                      <ImageIcon className="h-6 w-6" />
                    </div>
                  )}
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
