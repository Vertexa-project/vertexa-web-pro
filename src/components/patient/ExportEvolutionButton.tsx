import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdherenceSnapshot } from "@/hooks/useAdherenceSnapshot";
import { useBodyAssessments, useProgressPhotos, useWeightSeries } from "@/hooks/useBodyAssessments";
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
 * Botão "Exportar PDF" do Relatório de Evolução. Reusa os hooks existentes (react-query),
 * monta o documento e gera 100% no client (@react-pdf) — 1 clique, sem backend. Período
 * default: últimos 90 dias (selecionável). Estados: carregando dados, gerando, erro amigável.
 */
export function ExportEvolutionButton({ patient }: { patient: PatientDetail }) {
  const series = useWeightSeries(patient.id);
  const assessments = useBodyAssessments(patient.id);
  const photos = useProgressPhotos(patient.id);
  const adherence = useAdherenceSnapshot(patient.id);
  const professional = useCurrentProfessional();
  const clinic = useClinic(patient.clinic_id);

  const [periodValue, setPeriodValue] = useState<string>("90");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Espera os dados que preenchem o corpo do relatório (cabeçalho degrada sozinho).
  const dataLoading = series.isLoading || assessments.isLoading || photos.isLoading;

  async function handleExport() {
    setError(null);
    setGenerating(true);
    try {
      const period = PERIODS.find((p) => p.value === periodValue) ?? PERIODS[0];
      // Lazy: @react-pdf (~pesado) só entra no bundle quando o profissional exporta de fato.
      const { downloadEvolutionReport } = await import("@/lib/pdf/generateEvolutionReport");
      await downloadEvolutionReport({
        patient,
        weightSeries: series.data ?? [],
        assessments: assessments.data ?? [],
        photos: photos.data ?? [],
        adherence: adherence.data ?? null,
        professional: professional.data ? { fullName: professional.data.fullName, type: professional.data.type } : null,
        clinicName: clinic.data?.name ?? null,
        periodDays: period.days,
      });
    } catch (err) {
      // Não logar dados sensíveis; só a falha técnica.
      console.error("[VERTEXA] Falha ao gerar PDF de evolução:", err);
      setError("Não foi possível gerar o PDF. Tente novamente.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Select value={periodValue} onValueChange={setPeriodValue} disabled={generating}>
          <SelectTrigger className="h-9 w-40" aria-label="Período do relatório">
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
        <Button variant="default" size="sm" onClick={handleExport} disabled={generating || dataLoading}>
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {generating ? "Gerando…" : "Exportar PDF"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
