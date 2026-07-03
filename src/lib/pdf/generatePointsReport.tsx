/**
 * Orquestra a geração do Relatório de Pontos / VRI no CLIENT: monta o modelo a partir dos
 * dados já carregados (hooks/react-query), filtra o resumo de peso pelo período, gera o Blob
 * com @react-pdf e dispara o download. Sem backend, sem service_role.
 *
 * O VRI é LIDO do snapshot (a web nunca recalcula — PENDÊNCIA #3). Sem métricas de EXECUÇÃO
 * de treino (S-EXEC não existe): só dados REAIS. Campos ausentes degradam com elegância.
 */
import { pdf } from "@react-pdf/renderer";

import { PointsReportDoc, type PointsReportData } from "./PointsReport";
import { registerReportFonts } from "./fonts";
import { formatDate } from "@/lib/domain/format";
import type { AdherenceSnapshot, PatientDetail, ProfessionalType, WeightPoint } from "@/types/db";

export interface PointsReportInput {
  patient: PatientDetail;
  weightSeries: WeightPoint[];
  adherence: AdherenceSnapshot | null;
  professional: { fullName: string | null; type: ProfessionalType | null } | null;
  clinicName: string | null;
  /** Janela em dias a partir de hoje (resumo de peso). null = todo o período. */
  periodDays: number | null;
  /** "Agora" injetável (testes/determinismo). Default: new Date(). */
  now?: Date;
}

const fmtShort = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .toLowerCase() || "paciente"
  );
}

export function pointsReportFilename(patientName: string, now: Date): string {
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `pontos-${slugify(patientName)}-${ymd}.pdf`;
}

/**
 * Recado motivacional derivado do NÍVEL do VRI (copy, não é métrica inventada). Tom
 * celebrativo quando alto; construtivo/acolhedor quando baixo. Focado no retorno.
 */
function motivationalMessage(level: string | null | undefined): string {
  switch ((level ?? "").toLowerCase()) {
    case "alta":
      return "Parabéns! Sua adesão está excelente e a consistência aparece nos seus números. Continue nesse ritmo até o retorno — você está no caminho certo.";
    case "moderada":
      return "Bom progresso! Com mais alguns registros e treinos ao longo da semana você alcança o próximo nível. Conte com a sua equipe no retorno para ajustar o plano.";
    case "baixa":
      return "Vamos retomar o ritmo juntos. Pequenos passos diários fazem diferença — use o retorno para reencaixar o plano na sua rotina.";
    case "risco":
      return "Que bom ter você por aqui! Bora recomeçar com metas simples e possíveis. No retorno, ajustamos tudo para caber no seu dia a dia.";
    default:
      return "Cada registro conta. Traga suas dúvidas no retorno — juntos vamos montar o próximo passo da sua jornada.";
  }
}

/** Monta o modelo do relatório de pontos (síncrono — não há imagens a pré-baixar). */
export function buildPointsReportData(input: PointsReportInput): PointsReportData {
  const now = input.now ?? new Date();
  const from = input.periodDays != null ? new Date(now.getTime() - input.periodDays * 24 * 60 * 60 * 1000) : null;
  const inPeriod = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    if (!from) return true;
    const t = new Date(iso).getTime();
    return t >= from.getTime() && t <= now.getTime() + 24 * 60 * 60 * 1000;
  };

  const weightPoints = input.weightSeries.filter((p) => inPeriod(p.date));
  const a = input.adherence;
  const periodLabel = from ? `${fmtShort(from)} – ${fmtShort(now)}` : "Todo o período";

  return {
    patientName: input.patient.profile?.full_name ?? "Paciente",
    goal: input.patient.goal,
    professionalName: input.professional?.fullName ?? null,
    professionalType: input.professional?.type ?? null,
    clinicName: input.clinicName?.trim() || "Clínica",
    periodLabel,
    emittedAt: formatDate(now),
    vri: a
      ? {
          score: a.score,
          level: a.level,
          status: a.status,
          streak: a.streak,
          weeklyRate: a.weekly_completion_rate,
        }
      : null,
    positiveFactors: a?.positive_factors ?? [],
    riskFactors: a?.risk_factors ?? [],
    startWeight: input.patient.start_weight,
    currentWeight: input.patient.current_weight,
    targetWeight: input.patient.target_weight,
    weightPoints,
    motivationalMessage: motivationalMessage(a?.level),
  };
}

/** Gera o Blob do PDF a partir do modelo já montado. */
export async function generatePointsReportBlob(data: PointsReportData): Promise<Blob> {
  registerReportFonts();
  return pdf(<PointsReportDoc data={data} />).toBlob();
}

/** Fluxo completo: monta → gera → dispara download no navegador. */
export async function downloadPointsReport(input: PointsReportInput): Promise<void> {
  const now = input.now ?? new Date();
  const data = buildPointsReportData({ ...input, now });
  const blob = await generatePointsReportBlob(data);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = pointsReportFilename(data.patientName, now);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
