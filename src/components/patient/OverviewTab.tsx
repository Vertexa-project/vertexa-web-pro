import { AlertTriangle, CheckCircle2, Dumbbell, Target, Utensils } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNutritionPlan, useWorkoutPlan } from "@/hooks/usePlans";
import { formatPercent, formatWeight } from "@/lib/domain/format";
import type { AdherenceSnapshot, PatientDetail } from "@/types/db";

interface OverviewTabProps {
  patient: PatientDetail;
  snapshot: AdherenceSnapshot | null;
  onGoToTab: (value: string) => void;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

export function OverviewTab({ patient, snapshot, onGoToTab }: OverviewTabProps) {
  const workout = useWorkoutPlan(patient.id);
  const nutrition = useNutritionPlan(patient.id);

  const risks = snapshot?.risk_factors ?? [];
  const positives = snapshot?.positive_factors ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard label="Objetivo" value={patient.goal ?? "—"} />
        <SummaryCard
          label="Peso"
          value={`${formatWeight(patient.current_weight)} → ${formatWeight(patient.target_weight)}`}
        />
        <SummaryCard label="Sequência" value={snapshot?.streak != null ? `${snapshot.streak} dias` : "—"} />
        <SummaryCard label="Adesão semanal" value={formatPercent(snapshot?.weekly_completion_rate)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sinais recentes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {risks.length === 0 && positives.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem sinais relevantes no momento.</p>
            ) : null}
            {risks.map((r) => (
              <div key={r} className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
                <span className="text-foreground">{r}</span>
              </div>
            ))}
            {positives.map((p) => (
              <div key={p} className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
                <span className="text-muted-foreground">{p}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Planos ativos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Dumbbell className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span className="text-sm font-medium text-foreground">Treino</span>
                <Badge tone={workout.data ? "success" : "muted"}>
                  {workout.isLoading ? "…" : workout.data ? "Ativo" : "Pendente"}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Ver treino"
                onClick={() => onGoToTab("workout")}
              >
                Ver
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Utensils className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span className="text-sm font-medium text-foreground">Plano alimentar</span>
                <Badge tone={nutrition.data ? "success" : "muted"}>
                  {nutrition.isLoading ? "…" : nutrition.data ? "Ativo" : "Pendente"}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Ver plano alimentar"
                onClick={() => onGoToTab("nutrition")}
              >
                Ver
              </Button>
            </div>
            <div className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
              <Target className="h-4 w-4 shrink-0" aria-hidden />
              Acompanhe a evolução na aba Antropometria.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
