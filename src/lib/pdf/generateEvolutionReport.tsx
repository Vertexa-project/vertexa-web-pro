/**
 * Orquestra a geração do Relatório de Evolução no CLIENT: monta o modelo a partir dos dados
 * já carregados (hooks/react-query), filtra pelo período, pré-baixa as fotos (→ data URI),
 * gera o Blob com @react-pdf e dispara o download. Sem backend, sem service_role.
 */
import { pdf } from "@react-pdf/renderer";

import { EvolutionReportDoc, type EvolutionReportData } from "./EvolutionReport";
import { registerReportFonts } from "./fonts";
import { urlToDataUri } from "./images";
import { formatDate } from "@/lib/domain/format";
import type { AdherenceSnapshot, BodyAssessment, PatientDetail, ProfessionalType, ProgressPhoto, WeightPoint } from "@/types/db";

export interface EvolutionReportInput {
  patient: PatientDetail;
  weightSeries: WeightPoint[];
  assessments: BodyAssessment[];
  photos: ProgressPhoto[];
  adherence: AdherenceSnapshot | null;
  professional: { fullName: string | null; type: ProfessionalType | null } | null;
  clinicName: string | null;
  /** Janela em dias a partir de hoje. null = todo o período. Default de chamada: 90. */
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

export function evolutionReportFilename(patientName: string, now: Date): string {
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `evolucao-${slugify(patientName)}-${ymd}.pdf`;
}

/** Monta o modelo do relatório (assíncrono por causa do pré-fetch das fotos). */
export async function buildEvolutionReportData(input: EvolutionReportInput): Promise<EvolutionReportData> {
  const now = input.now ?? new Date();
  const from = input.periodDays != null ? new Date(now.getTime() - input.periodDays * 24 * 60 * 60 * 1000) : null;
  const inPeriod = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    if (!from) return true;
    const t = new Date(iso).getTime();
    return t >= from.getTime() && t <= now.getTime() + 24 * 60 * 60 * 1000;
  };

  const weightPoints = input.weightSeries.filter((p) => inPeriod(p.date));
  const assessments = input.assessments.filter((a) => inPeriod(a.assessed_at)); // já vem asc

  // Fotos do período, ascendente por data → antes (mais antiga) / depois (mais recente).
  const photosAsc = [...input.photos]
    .filter((p) => inPeriod(p.taken_at))
    .sort((a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime());
  let photos: EvolutionReportData["photos"] = null;
  if (photosAsc.length > 0) {
    const first = photosAsc[0];
    const last = photosAsc[photosAsc.length - 1];
    const twoDistinct = photosAsc.length >= 2;
    const [beforeUri, afterUri] = await Promise.all([
      twoDistinct ? urlToDataUri(first.photo_url) : Promise.resolve(null),
      urlToDataUri(last.photo_url),
    ]);
    photos = {
      beforeUri,
      beforeCaption: twoDistinct ? formatDate(first.taken_at) : "—",
      afterUri,
      afterCaption: formatDate(last.taken_at),
    };
  }

  const periodLabel = from ? `${fmtShort(from)} – ${fmtShort(now)}` : "Todo o período";

  return {
    patientName: input.patient.profile?.full_name ?? "Paciente",
    goal: input.patient.goal,
    sex: input.patient.sex,
    heightCm: input.patient.height_cm,
    professionalName: input.professional?.fullName ?? null,
    professionalType: input.professional?.type ?? null,
    clinicName: input.clinicName?.trim() || "Clínica",
    periodLabel,
    emittedAt: formatDate(now),
    startWeight: input.patient.start_weight,
    currentWeight: input.patient.current_weight,
    targetWeight: input.patient.target_weight,
    adherence: input.adherence
      ? {
          score: input.adherence.score,
          level: input.adherence.level,
          streak: input.adherence.streak,
          weeklyRate: input.adherence.weekly_completion_rate,
        }
      : null,
    weightPoints,
    assessments,
    photos,
  };
}

/** Gera o Blob do PDF a partir do modelo já montado. */
export async function generateEvolutionReportBlob(data: EvolutionReportData): Promise<Blob> {
  registerReportFonts();
  return pdf(<EvolutionReportDoc data={data} />).toBlob();
}

/** Fluxo completo: monta → gera → dispara download no navegador. */
export async function downloadEvolutionReport(input: EvolutionReportInput): Promise<void> {
  const now = input.now ?? new Date();
  const data = await buildEvolutionReportData({ ...input, now });
  const blob = await generateEvolutionReportBlob(data);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = evolutionReportFilename(data.patientName, now);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // pequeno atraso não é necessário: o click síncrono já iniciou o download.
    URL.revokeObjectURL(url);
  }
}
