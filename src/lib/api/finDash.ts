// Financeiro · Entrega 7: painel financeiro. Toda leitura é por RPC (fin_dashboard_*): o servidor confere papel e unidade e calcula cada número e a lista que o compõe (F12).
import { supabase } from "@/lib/supabase";
import type { DashDetail, DashParams, DashMetric, DashSummary } from "@/lib/domain/finDash";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/** Uma chamada por tela: indicadores do topo, evolução de 12 meses, blocos e contagem das pendências. */
export const getDashboardSummary = (clinicId: string, period: string, unitId?: string | null) =>
  rpc<DashSummary>("fin_dashboard_summary", { p_clinic: clinicId, p_period: period, p_unit: unitId || null });

/** F12: a lista de linhas que compõe um número (paginada). `total_cents` é a soma de TODAS as linhas; `value_cents` de cada linha é a parte dela. */
export const getDashboardDetail = (clinicId: string, metric: DashMetric, period: string, unitId: string | null, params: DashParams = {}, offset = 0, limit = 300) =>
  rpc<DashDetail>("fin_dashboard_detail", { p_clinic: clinicId, p_metric: metric, p_period: period, p_unit: unitId || null, p_params: params, p_limit: limit, p_offset: offset });
