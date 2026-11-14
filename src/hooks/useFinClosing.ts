// Hooks do Financeiro · Entrega 6 (fechamento mensal). Mesmo padrão de useFinPayout.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/lib/api/finClosing";
import type { AdjustKind, PayMethod } from "@/lib/domain/finClosing";

const K = ["fin", "e6"] as const;
const on = (clinicId: string | null, extra = true) => Boolean(clinicId) && extra;

export const useClosing = (clinicId: string | null, period: string, unitId: string | null, enabled = true) =>
  useQuery({ queryKey: [...K, "closing", clinicId, period, unitId], queryFn: () => api.getClosing(clinicId as string, period, unitId), enabled: on(clinicId, enabled) });
export const useStatement = (statementId: string | null) =>
  useQuery({ queryKey: [...K, "statement", statementId], queryFn: () => api.getStatement(statementId as string), enabled: Boolean(statementId) });
export const useMyStatements = (clinicId: string | null, enabled = true) =>
  useQuery({ queryKey: [...K, "mine", clinicId], queryFn: () => api.listMyStatements(clinicId as string), enabled: on(clinicId, enabled) });

function useClosingMutation<TVars, TOut = unknown>(fn: (v: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  // o fechamento mexe na tabela do gestor, nos extratos, no repasse do mês e no Histórico
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: K }), qc.invalidateQueries({ queryKey: ["fin", "e5"] }), qc.invalidateQueries({ queryKey: ["fin", "audit"] })]),
  });
}
export const useStartClosing = (clinicId: string) => useClosingMutation((period: string) => api.startClosing(clinicId, period));
export const useRefreshClosing = () => useClosingMutation((v: { closingId: string; professionalId?: string | null }) => api.refreshClosing(v.closingId, v.professionalId));
export const useNotifyClosing = () => useClosingMutation((v: { closingId: string; professionalIds?: string[] | null }) => api.notifyClosing(v.closingId, v.professionalIds));
export const useApproveClosing = () => useClosingMutation((v: { closingId: string; professionalIds?: string[] | null }) => api.approveClosing(v.closingId, v.professionalIds));
export const useLockClosing = () => useClosingMutation((v: { closingId: string; reason?: string }) => api.lockClosing(v.closingId, v.reason));
export const useUnlockClosing = () => useClosingMutation((v: { closingId: string; reason: string }) => api.unlockClosing(v.closingId, v.reason));
export const useAcceptStatement = () => useClosingMutation((statementId: string) => api.acceptStatement(statementId));
export const useContestStatement = () => useClosingMutation((v: { statementId: string; comment: string; lineId?: string | null; lineLabel?: string | null }) => api.contestStatement(v.statementId, v.comment, v.lineId, v.lineLabel));
export const useAnswerDispute = () => useClosingMutation((v: { disputeId: string; response: string }) => api.answerDispute(v.disputeId, v.response));
export const useAdjustStatement = () => useClosingMutation((v: { statementId: string; kind: AdjustKind; amountCents: number; reason: string }) => api.adjustStatement(v.statementId, v.kind, v.amountCents, v.reason));
export const useSaveInvoice = (clinicId: string) =>
  useClosingMutation(async (v: { statementId: string; number: string; date: string; file: File }) => {
    const path = await api.uploadClosingFile(clinicId, v.statementId, "nf", v.file);
    return api.saveInvoice(v.statementId, v.number, v.date, path);
  });
export const usePayStatement = (clinicId: string) =>
  useClosingMutation(async (v: { statementId: string; paidOn: string; method: PayMethod; file: File; note?: string | null }) => {
    const proofPath = await api.uploadClosingFile(clinicId, v.statementId, "comprovante", v.file);
    return api.payStatement(v.statementId, { paidOn: v.paidOn, method: v.method, proofPath, note: v.note });
  });
