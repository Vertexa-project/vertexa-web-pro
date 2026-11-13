// Hooks do Financeiro · Entrega 2 (vendas, títulos, caixa). Mesmo padrão de useFin.ts; separados para não mexer no arquivo da Entrega 1.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/lib/api/finSales";

const K = ["fin", "e2"] as const;
const on = (clinicId: string | null, extra = true) => Boolean(clinicId) && extra;

export const useSaleCatalog = (clinicId: string | null, unitId: string | null) =>
  useQuery({ queryKey: [...K, "catalog", clinicId, unitId], queryFn: () => api.getSaleCatalog(clinicId as string, unitId as string), enabled: on(clinicId, Boolean(unitId)) });
export const usePaymentOptions = (clinicId: string | null, unitId: string | null, enabled = true) =>
  useQuery({ queryKey: [...K, "payopts", clinicId, unitId], queryFn: () => api.getPaymentOptions(clinicId as string, unitId as string), enabled: on(clinicId, Boolean(unitId) && enabled) });
export const useSalePatients = (clinicId: string | null, search: string) =>
  useQuery({ queryKey: [...K, "patients", clinicId, search], queryFn: () => api.searchSalePatients(clinicId as string, search), enabled: on(clinicId) });
export const useComplianceStatus = (clinicId: string | null, unitId: string | null) =>
  useQuery({ queryKey: [...K, "compliance", clinicId, unitId], queryFn: () => api.getComplianceStatus(clinicId as string, unitId as string), enabled: on(clinicId, Boolean(unitId)) });
export const useSales = (clinicId: string | null, f: api.SalesFilter, enabled = true) =>
  useQuery({ queryKey: [...K, "sales", clinicId, f], queryFn: () => api.listSales(clinicId as string, f), enabled: on(clinicId, enabled) });
export const useSale = (saleId: string | null) =>
  useQuery({ queryKey: [...K, "sale", saleId], queryFn: () => api.getSale(saleId as string), enabled: Boolean(saleId), staleTime: 0 });
export const useTitles = (clinicId: string | null, f: api.TitleFilter, enabled = true) =>
  useQuery({ queryKey: [...K, "titles", clinicId, f], queryFn: () => api.listTitles(clinicId as string, f), enabled: on(clinicId, enabled) });
export const useMyOpenCash = (clinicId: string | null, enabled = true) =>
  useQuery({ queryKey: [...K, "mycash", clinicId], queryFn: () => api.getMyOpenCash(clinicId as string), enabled: on(clinicId, enabled), staleTime: 0 });
export const useCashReport = (clinicId: string | null, f: api.CashFilter, enabled = true) =>
  useQuery({ queryKey: [...K, "cashreport", clinicId, f], queryFn: () => api.listCashReport(clinicId as string, f), enabled: on(clinicId, enabled) });

function useE2Mutation<TVars, TOut = unknown>(fn: (v: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  // Qualquer escrita pode mexer em venda, título e caixa: invalida o grupo inteiro da Entrega 2 (e a auditoria da Entrega 1).
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: K }), qc.invalidateQueries({ queryKey: ["fin", "audit"] })]) });
}

export const useSaveSale = (clinicId: string) => useE2Mutation((v: api.SaveSaleInput) => api.saveSale(clinicId, v));
export const useCancelSale = () => useE2Mutation((v: { saleId: string; reason: string }) => api.cancelSale(v.saleId, v.reason));
export const useAddPayment = () => useE2Mutation((v: { saleId: string; input: api.AddPaymentInput }) => api.addPayment(v.saleId, v.input));
export const useAcceptCompliance = (clinicId: string) => useE2Mutation((v: { unitId: string }) => api.acceptCompliance(clinicId, v.unitId));
export const useSettleTitle = () => useE2Mutation((v: { id: string }) => api.settleTitle(v.id));
export const useCorrectTitle = () => useE2Mutation((v: { id: string; date: string; netCents: number; reason: string }) => api.correctTitle(v.id, v.date, v.netCents, v.reason));
export const useReverseTitle = () => useE2Mutation((v: { id: string; reason: string }) => api.reverseTitle(v.id, v.reason));
export const useOpenCash = (clinicId: string) => useE2Mutation((v: { unitId: string; openingCents: number }) => api.openCash(clinicId, v.unitId, v.openingCents));
export const useCashMovement = () => useE2Mutation((v: { registerId: string; type: "sangria" | "suprimento"; amountCents: number; reason: string }) => api.cashMovement(v.registerId, v.type, v.amountCents, v.reason));
export const useCloseCash = () => useE2Mutation((v: { registerId: string; counted: Record<string, number>; justification: string }) => api.closeCash(v.registerId, v.counted, v.justification));
export const useApproveCash = () => useE2Mutation((v: { registerId: string; note?: string }) => api.approveCash(v.registerId, v.note));
