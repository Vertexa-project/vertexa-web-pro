import { ShieldCheck } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BadgeTone } from "@/lib/domain/vri";
import { useProgressPhotos } from "@/hooks/useBodyAssessments";
import { useHydrationDaily } from "@/hooks/useHydration";
import { useMuscleRecovery } from "@/hooks/useMuscleRecovery";
import { formatDate } from "@/lib/domain/format";
import {
  RISK_THRESHOLDS,
  bySeverity,
  computeRiskSignals,
  type RiskSeverity,
} from "@/lib/domain/riskSignals";

const SEVERITY_META: Record<RiskSeverity, { tone: BadgeTone; label: string }> = {
  high: { tone: "destructive", label: "Alto" },
  warn: { tone: "warning", label: "Atenção" },
  info: { tone: "info", label: "Info" },
};

/**
 * Painel "Sinais de risco" — COMPLEMENTAR ao VRI (não o duplica). Lista os sinais ATIVOS
 * (sobrecarga muscular, meta de água, foto ausente) em tom clínico e mostra de forma discreta
 * os "sem dados" (ex.: mobilidade). Tudo DERIVADO/read-only; nada é fabricado. loading/empty/erro.
 */
export function RiskSignalsPanel({ patientId }: { patientId: string }) {
  const muscle = useMuscleRecovery(patientId);
  const hydration = useHydrationDaily(patientId, RISK_THRESHOLDS.waterWindowDays);
  const photos = useProgressPhotos(patientId);

  const isLoading = muscle.isLoading || hydration.isLoading || photos.isLoading;
  const isError = muscle.isError || hydration.isError || photos.isError;
  const retry = () => {
    if (muscle.isError) muscle.refetch();
    if (hydration.isError) hydration.refetch();
    if (photos.isError) photos.refetch();
  };

  const lastPhotoAt = photos.data && photos.data.length > 0 ? photos.data[0].taken_at : null;
  const signals = computeRiskSignals({
    muscles: muscle.data ?? [],
    hydrationDaily: hydration.data ?? [],
    lastPhotoAt,
  });

  const active = signals.filter((s) => s.active).sort(bySeverity);
  const unavailable = signals.filter((s) => !s.available);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sinais de risco</CardTitle>
        <p className="text-sm text-muted-foreground">
          Complementar ao VRI — pontos concretos para o retorno. Derivado dos registros do app.
        </p>
      </CardHeader>
      <CardContent>
        {/* isEmpty=false de propósito: o painel controla a própria apresentação de "vazio"
            (mensagem "Sem sinais…" + a nota discreta de "sem dados"), que precisa aparecer MESMO
            sem sinais ativos — logo NÃO roteamos pelo EmptyState do AsyncSection (só loading/erro). */}
        <AsyncSection
          isLoading={isLoading}
          isError={isError}
          isEmpty={false}
          onRetry={retry}
          emptyTitle="Sem sinais de risco"
        >
          <div className="space-y-4">
            {active.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-hidden />
                Sem sinais de risco no período.
              </div>
            ) : (
              <ul className="space-y-3">
                {active.map((sig) => {
                  const meta = SEVERITY_META[sig.severity];
                  return (
                    <li key={sig.kind} className="flex items-start gap-3">
                      <Badge tone={meta.tone} className="mt-0.5 shrink-0">
                        {meta.label}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{sig.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {sig.detail}
                          {sig.since ? ` · desde ${formatDate(sig.since)}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {unavailable.length > 0 ? (
              <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                Sem dados:{" "}
                {unavailable.map((s) => s.title).join(", ")} — fonte ainda inexistente (não estimado).
              </p>
            ) : null}
          </div>
        </AsyncSection>
      </CardContent>
    </Card>
  );
}
