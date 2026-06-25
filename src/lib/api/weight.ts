import { supabase } from "@/lib/supabase";
import type { WeightLog, WeightPoint } from "@/types/db";
import { getBodyAssessments } from "./assessments";

/** Pesos auto-reportados pelo paciente (app) em ordem cronológica (asc). */
export async function getWeightLogs(patientId: string): Promise<WeightLog[]> {
  const { data, error } = await supabase
    .from("weight_logs")
    .select("*")
    .eq("patient_id", patientId)
    .order("measured_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as WeightLog[];
}

/**
 * Série unificada de peso para o gráfico: avaliações clínicas (body_assessments.weight) +
 * auto-reportes do app (weight_logs.weight_kg), normalizados e ordenados por data (asc).
 * Ver docs/CONTRATO_INTEGRACAO.md — o app grava o VALOR do peso em weight_logs.
 */
export async function getWeightSeries(patientId: string): Promise<WeightPoint[]> {
  const [assessments, logs] = await Promise.all([
    getBodyAssessments(patientId),
    getWeightLogs(patientId),
  ]);

  const points: WeightPoint[] = [];
  for (const a of assessments) {
    if (a.weight != null && a.assessed_at) {
      points.push({
        date: a.assessed_at,
        weight: Number(a.weight),
        source: "assessment",
        method: a.method,
      });
    }
  }
  for (const l of logs) {
    if (l.weight_kg == null || !l.measured_at) continue;
    points.push({ date: l.measured_at, weight: Number(l.weight_kg), source: "app", method: null });
  }
  points.sort((x, y) => new Date(x.date).getTime() - new Date(y.date).getTime());
  return points;
}
