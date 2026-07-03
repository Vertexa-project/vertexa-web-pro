import { useState } from "react";
import { Award, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdherenceSnapshot } from "@/hooks/useAdherenceSnapshot";
import { useWeightSeries } from "@/hooks/useBodyAssessments";
import { useClinic } from "@/hooks/useClinic";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import type { PatientDetail } from "@/types/db";

const PERIODS: Array<{ value: string; label: string; days: number | null }> = [
  { value: "90", label: "Últimos 90 dias", days: 90 },
  { value: "180", label: "Últimos 6 meses", days: 180 },
  { value: "365", label: "Últimos 12 meses", days: 365 },
  { value: "all", label: "Todo o período", days: null },
];

/**
 * Botão "Relatório de Pontos (PDF)" — one-pager de PONTUAÇÃO/VRI para o paciente levar ao
 * retorno (WhatsApp/impressão). Reusa os hooks existentes (react-query) e gera 100% no client
 * (@react-pdf). O VRI é LIDO do snapshot (nunca recalculado). O período escopa só o resumo de
 * peso. Estados: carregando dados, gerando, erro amigável.
 */
export function ExportPointsButton({ patient }: { patient: PatientDetail }) {
  const series = useWeightSeries(patient.id);
  const adherence = useAdherenceSnapshot(patient.id);
  const professional = useCurrentProfessional();
  const clinic = useClinic(patient.clinic_id);

  const [periodValue, setPeriodValue] = useState<string>("90");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // O VRI (herói) é o essencial; se ainda estiver carregando, esperamos para não gerar "—".
  const dataLoading = adherence.isLoading || series.isLoading;

  async function handleExport() {
    setError(null);
    setGenerating(true);
    try {
      const period = PERIODS.find((p) => p.value === periodValue) ?? PERIODS[0];
      // Lazy: @react-pdf (~pesado) só entra no bundle quando o profissional exporta de fato.
      const { downloadPointsReport } = await import("@/lib/pdf/generatePointsReport");
      await downloadPointsReport({
        patient,
        weightSeries: series.data ?? [],
        adherence: adherence.data ?? null,
        professional: professional.data
          ? { fullName: professional.data.fullName, type: professional.data.type }
          : null,
        clinicName: clinic.data?.name ?? null,
        periodDays: period.days,
      });
    } catch (err) {
      // Não logar dados sensíveis; só a falha técnica.
      console.error("[VERTEXA] Falha ao gerar PDF de pontos:", err);
      setError("Não foi possível gerar o PDF. Tente novamente.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Select value={periodValue} onValueChange={setPeriodValue} disabled={generating}>
          <SelectTrigger className="h-9 w-40" aria-label="Período do relatório de pontos">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={generating || dataLoading}>
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />}
          {generating ? "Gerando…" : "Relatório de Pontos (PDF)"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
