import { useMemo, useState } from "react";
import { ImageIcon, Ruler, Upload } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { WeightChart } from "@/components/charts/WeightChart";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBodyAssessments, useProgressPhotos } from "@/hooks/useBodyAssessments";
import { formatWeight } from "@/lib/domain/format";
import type { PatientDetail } from "@/types/db";

const METHOD_LABELS: Record<string, string> = {
  bioimpedancia: "Bioimpedância",
  adipometro: "Adipômetro",
  dobras: "Dobras cutâneas",
  circunferencias: "Circunferências",
  dexa: "DEXA",
  manual: "Manual",
};

function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

export function AnthropometryTab({ patient }: { patient: PatientDetail }) {
  const { data, isLoading, isError, refetch } = useBodyAssessments(patient.id);
  const photos = useProgressPhotos(patient.id);
  const [method, setMethod] = useState<string>("all");
  const [notice, setNotice] = useState<string | null>(null);

  const methods = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((a) => a.method && set.add(a.method));
    return [...set];
  }, [data]);

  const filtered = useMemo(
    () => (method === "all" ? (data ?? []) : (data ?? []).filter((a) => a.method === method)),
    [data, method],
  );

  const latest = data && data.length > 0 ? data[data.length - 1] : null;
  const currentWeight = patient.current_weight ?? latest?.weight ?? null;
  const heightM = patient.height_cm ? patient.height_cm / 100 : null;
  const imc = currentWeight && heightM ? currentWeight / (heightM * heightM) : null;
  const bodyFat = latest?.body_fat_pct ?? null;

  return (
    <AsyncSection
      isLoading={isLoading}
      isError={isError}
      isEmpty={!data || data.length === 0}
      onRetry={() => refetch()}
      emptyIcon={Ruler}
      emptyTitle="Sem avaliações corporais"
      emptyDescription="Registre uma avaliação (peso, dobras, bioimpedância…) para acompanhar a evolução."
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard label="Peso atual" value={formatWeight(currentWeight)} />
          <MetricCard label="Meta" value={formatWeight(patient.target_weight)} />
          <MetricCard label="IMC" value={imc ? imc.toFixed(1) : "—"} />
          <MetricCard label="% Gordura" value={bodyFat != null ? `${bodyFat}%` : "—"} />
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Evolução de peso</CardTitle>
            {methods.length > 0 ? (
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="w-44" aria-label="Método de avaliação">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os métodos</SelectItem>
                  {methods.map((m) => (
                    <SelectItem key={m} value={m}>
                      {methodLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </CardHeader>
          <CardContent>
            {filtered.length > 0 ? (
              <WeightChart assessments={filtered} />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Sem registros para o método selecionado.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Fotos comparativas</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNotice("Upload de foto/documento chega em breve.")}
            >
              <Upload className="h-4 w-4" />
              Enviar documento
            </Button>
          </CardHeader>
          <CardContent>
            {notice ? (
              <p className="mb-3 text-sm text-info" role="status" aria-live="polite">
                {notice}
              </p>
            ) : null}
            {photos.data && photos.data.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {photos.data.map((p) => (
                  <img
                    key={p.id}
                    src={p.photo_url}
                    alt="Foto de progresso"
                    className="aspect-[3/4] w-full rounded-md object-cover"
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={ImageIcon}
                title="Sem fotos de progresso"
                description="As fotos enviadas pelo paciente no app aparecerão aqui, mês a mês."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </AsyncSection>
  );
}
