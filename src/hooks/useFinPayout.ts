// Hooks do Financeiro · Entrega 5 (motor de repasse). Mesmo padrão de useFinAppointments.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/lib/api/finPayout";

const K = ["fin", "e5"] as const;
const on = (clinicId: string | null, extra = true) => Boolean(clinicId) && extra;

export const usePayoutContext = (clinicId: string | null, enabled = true) =>
  useQuery({ queryKey: [...K, "context", clinicId], queryFn: () => api.getPayoutContext(clinicId as string), enabled: on(clinicId, enabled) });
export const usePayoutRules = (clinicId: string | null, professionalId: string | null, includeInactive: boolean, enabled = true) =>
  useQuery({ queryKey: [...K, "rules", clinicId, professionalId, includeInactive], queryFn: () => api.listPayoutRules(clinicId as string, professionalId, includeInactive), enabled: on(clinicId, enabled) });
export const usePayoutLines = (clinicId: string | null, f: { professionalId?: string | null; period?: string | null }, enabled = true) =>
  useQuery({ queryKey: [...K, "lines", clinicId, f], queryFn: () => api.listPayoutLines(clinicId as string, f), enabled: on(clinicId, enabled) });
export const usePayoutMonth = (clinicId: string | null, professionalId: string | null, period: string, enabled = true) =>
  useQuery({ queryKey: [...K, "month", clinicId, professionalId, period], queryFn: () => api.getPayoutMonth(clinicId as string, professionalId, period), enabled: on(clinicId, enabled) });
export const usePayoutMonthAll = (clinicId: string | null, period: string, enabled = true) =>
  useQuery({ queryKey: [...K, "monthAll", clinicId, period], queryFn: () => api.getPayoutMonthAll(clinicId as string, period), enabled: on(clinicId, enabled) });
export const useUnruled = (clinicId: string | null, enabled = true) =>
  useQuery({ queryKey: [...K, "unruled", clinicId], queryFn: () => api.listUnruled(clinicId as string), enabled: on(clinicId, enabled) });
export const useMedCommissions = (clinicId: string | null, enabled = true) =>
  useQuery({ queryKey: [...K, "med", clinicId], queryFn: () => api.listMedCommissions(clinicId as string), enabled: on(clinicId, enabled) });

function usePayoutMutation<TVars, TOut = unknown>(fn: (v: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  // regra e recálculo mexem em lançamentos, na fila «sem regra» e no Histórico
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: K }), qc.invalidateQueries({ queryKey: ["fin", "audit"] })]) });
}
export const useSavePayoutRule = (clinicId: string) => usePayoutMutation((v: api.SavePayoutRuleInput) => api.savePayoutRule(clinicId, v));
export const useSetPayoutRuleActive = () => usePayoutMutation((v: { ruleId: string; active: boolean; reason: string }) => api.setPayoutRuleActive(v.ruleId, v.active, v.reason));
export const useRecalcPayout = (clinicId: string) => usePayoutMutation((v: { from?: string | null; to?: string | null }) => api.recalcPayout(clinicId, v.from, v.to));
