import { format, startOfDay, subDays } from "date-fns";

import { supabase } from "@/lib/supabase";

/**
 * Água de HOJE = soma de activity_events(type='hydration_logged') do dia, campo payload.liters.
 *
 * Contrato (docs/CONTRATO_INTEGRACAO.md): a chave canônica é `liters` (número, em litros).
 * Mantemos tolerância ao alias legado `amount` (drift do app — Habits.tsx grava {amount})
 * para a leitura não quebrar enquanto o app não padroniza. NÃO há tabela de água: é derivado.
 */
export async function getHydrationTodayLiters(patientId: string): Promise<number> {
  const since = startOfDay(new Date()).toISOString();
  const { data, error } = await supabase
    .from("activity_events")
    .select("payload, created_at")
    .eq("patient_id", patientId)
    .eq("type", "hydration_logged")
    .gte("created_at", since);
  if (error) throw error;

  let total = 0;
  for (const row of (data ?? []) as { payload: Record<string, unknown> | null }[]) {
    const raw = row.payload?.liters ?? row.payload?.amount;
    // Tolera número OU string numérica (o app pode gravar "2.5"); ignora o resto.
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (typeof value === "number" && Number.isFinite(value)) total += value;
  }
  return total;
}

export interface HydrationDay {
  date: string; // "yyyy-MM-dd" (dia LOCAL)
  liters: number;
}

/**
 * Litros de água por DIA nos últimos `days` dias COMPLETOS (exclui o dia de hoje, que ainda está
 * em curso — senão um relatório penalizaria injustamente o dia parcial). Derivado de
 * activity_events(hydration_logged).payload.liters (mesma chave canônica; tolera alias `amount`).
 * Retorna SEMPRE `days` posições (dias sem registro entram com 0 litros — ausência é informação).
 * READ-ONLY, sem tabela de água. Base do sinal de "meta de água não batida".
 */
export async function getHydrationDailyLiters(patientId: string, days = 7): Promise<HydrationDay[]> {
  const todayStart = startOfDay(new Date());
  const windowStart = subDays(todayStart, days); // início do 1º dia completo da janela
  const { data, error } = await supabase
    .from("activity_events")
    .select("payload, created_at")
    .eq("patient_id", patientId)
    .eq("type", "hydration_logged")
    .gte("created_at", windowStart.toISOString())
    .lt("created_at", todayStart.toISOString());
  if (error) throw error;

  // Buckets zerados p/ cada dia completo da janela (mais antigo → mais recente).
  const byDay = new Map<string, number>();
  for (let i = days; i >= 1; i--) {
    byDay.set(format(subDays(todayStart, i), "yyyy-MM-dd"), 0);
  }
  for (const row of (data ?? []) as { payload: Record<string, unknown> | null; created_at: string }[]) {
    const raw = row.payload?.liters ?? row.payload?.amount;
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const key = format(startOfDay(new Date(row.created_at)), "yyyy-MM-dd");
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + value);
  }
  return Array.from(byDay.entries()).map(([date, liters]) => ({ date, liters }));
}
