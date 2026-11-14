// Hooks do Financeiro · Entrega 7 (painel). Só leitura; cada abertura de tela busca de novo (os números mudam a cada venda, recebimento e atendimento).
import { useQuery } from "@tanstack/react-query";

import * as api from "@/lib/api/finDash";
import type { DashTarget } from "@/lib/domain/finDash";

const K = ["fin", "e7"] as const;

export const useDashboard = (clinicId: string | null, period: string, unitId: string | null, enabled = true) =>
  useQuery({ queryKey: [...K, "summary", clinicId, period, unitId], queryFn: () => api.getDashboardSummary(clinicId as string, period, unitId), enabled: Boolean(clinicId) && enabled, staleTime: 0 });

/** Primeira página da lista de um número; as próximas vêm por api.getDashboardDetail («Carregar mais»). */
export const useDashDetail = (clinicId: string | null, target: DashTarget | null) =>
  useQuery({
    queryKey: [...K, "detail", clinicId, target?.metric, target?.period, target?.unitId, target?.params ?? null],
    queryFn: () => api.getDashboardDetail(clinicId as string, (target as DashTarget).metric, (target as DashTarget).period, (target as DashTarget).unitId, (target as DashTarget).params ?? {}),
    enabled: Boolean(clinicId) && target !== null, staleTime: 0,
  });
