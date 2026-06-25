import { startOfDay } from "date-fns";

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
