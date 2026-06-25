import { useMemo, useState } from "react";
import { Droplet, Ruler } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { WeightChart } from "@/components/charts/WeightChart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBodyAssessments, useWeightSeries } from "@/hooks/useBodyAssessments";
import { useHydrationToday } from "@/hooks/useHydration";
import { formatLiters, formatWeight } from "@/lib/domain/format";
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
  // Série unificada (avaliações clínicas + registros do app) → gráfico + "peso atual".
  const series = useWeightSeries(patient.id);
  // Avaliações clínicas: alimentam % de gordura e a lista de métodos do filtro.
  const { data: assessments } = useBodyAssessments(patient.id);
  const hydration = useHydrationToday(patient.id);
  const [method, setMethod] = useState<string>("all");

  const points = useMemo(() => series.data ?? [], [series.data]);
  const assessmentList = useMemo(() => assessments ?? [], [assessments]);

  const methods = useMemo(() => {
    const set = new Set<string>();
    points.forEach((p) => {
      if (p.source === "assessment" && p.method) set.add(p.method);
    });
    return [...set];
  }, [points]);

  // method="all" → série completa; método específico → só as avaliações clínicas daquele método.
  const chartPoints = useMemo(
    () =>
      method === "all"
        ? points
        : points.filter((p) => p.source === "assessment" && p.method === method),
    [points, method],
  );

  const latestPoint = points.length > 0 ? points[points.length - 1] : null;
  const latestAssessment =
    assessmentList.length > 0 ? assessmentList[assessmentList.length - 1] : null;
  // "Peso atual" = última medição (qualquer origem); cai para o peso oficial do cadastro.
  const currentWeight = latestPoint?.weight ?? patient.current_weight ?? null;
  const heightM = patient.height_cm ? patient.height_cm / 100 : null;
  const imc = currentWeight && heightM ? currentWeight / (heightM * heightM) : null;
  const bodyFat = latestAssessment?.body_fat_pct ?? null;

  return (
    <AsyncSection
      isLoading={series.isLoading}
      isError={series.isError}
      isEmpty={points.length === 0}
      onRetry={() => series.refetch()}
      emptyIcon={Ruler}
      emptyTitle="Sem registros de peso"
      emptyDescription="Avaliações clínicas e os pesos registrados pelo paciente no app aparecerão aqui."
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
                  <SelectItem value="all">Todos os registros</SelectItem>
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
            {chartPoints.length > 0 ? (
              <>
                <WeightChart points={chartPoints} />
                <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
                    Registro do app
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-info" aria-hidden />
                    Avaliação clínica
                  </span>
                </div>
              </>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Sem registros para o método selecionado.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Hidratação de hoje</CardTitle>
          </CardHeader>
          <CardContent>
            {hydration.isError ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Não foi possível carregar a hidratação de hoje.
                </p>
                <Button variant="outline" size="sm" onClick={() => hydration.refetch()}>
                  Tentar novamente
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-info/10 text-info"
                  aria-hidden
                >
                  <Droplet className="h-5 w-5" />
                </span>
                <div>
                  {hydration.isLoading ? (
                    <span
                      className="block h-7 w-20 animate-pulse rounded bg-muted"
                      role="status"
                      aria-label="Carregando hidratação"
                    />
                  ) : (
                    <p className="text-2xl font-semibold text-foreground">
                      {formatLiters(hydration.data ?? 0)}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Soma dos registros de água do app hoje
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AsyncSection>
  );
}
