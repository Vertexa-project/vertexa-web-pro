// Hooks do Estoque · Entrega 8 (inventário, transferências, alertas, relatórios). Mesmo padrão de useStockMoves.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/lib/api/stockE8";

const K = ["fin", "e8"] as const;
const on = (clinicId: string | null, extra = true) => Boolean(clinicId) && extra;

export const useTransfers = (clinicId: string | null, f: api.TransferFilter, enabled = true) =>
  useQuery({ queryKey: [...K, "transfers", clinicId, f], queryFn: () => api.listTransfers(clinicId as string, f), enabled: on(clinicId, enabled) });
export const useInventories = (clinicId: string | null, f: api.InventoryFilter, enabled = true) =>
  useQuery({ queryKey: [...K, "inventories", clinicId, f], queryFn: () => api.listInventories(clinicId as string, f), enabled: on(clinicId, enabled) });
export const useInventoryLines = (inventoryId: string | null, status: string | null) =>
  useQuery({ queryKey: [...K, "inventoryLines", inventoryId, status], queryFn: () => api.listInventoryLines(inventoryId as string), enabled: Boolean(inventoryId), staleTime: 0 });
export const useStockAlerts = (clinicId: string | null, unitId: string | null, enabled = true) =>
  useQuery({ queryKey: [...K, "alerts", clinicId, unitId], queryFn: () => api.getStockAlerts(clinicId as string, unitId), enabled: on(clinicId, enabled) });
export const useStockReport = (clinicId: string | null, report: api.ReportKey, f: api.ReportFilter, enabled = true) =>
  useQuery({ queryKey: [...K, "report", clinicId, report, f], queryFn: () => api.getStockReport(clinicId as string, report, f), enabled: on(clinicId, enabled) });

function useE8Mutation<TVars, TOut = unknown>(fn: (v: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  // Transferência e inventário mexem em saldo, kardex, alertas e Histórico: invalida o grupo da E8, o da E3 e a auditoria.
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: K }), qc.invalidateQueries({ queryKey: ["fin", "e3"] }), qc.invalidateQueries({ queryKey: ["fin", "audit"] })]) });
}

export const useSendTransfer = (clinicId: string) => useE8Mutation((v: { from: string; to: string; lines: api.TransferSendLine[]; notes: string }) => api.sendTransfer(clinicId, v.from, v.to, v.lines, v.notes));
export const useReceiveTransfer = () => useE8Mutation((v: { transferId: string; lines: api.TransferReceiveLine[]; note: string }) => api.receiveTransfer(v.transferId, v.lines, v.note));
export const useCancelTransfer = () => useE8Mutation((v: { transferId: string; reason: string }) => api.cancelTransfer(v.transferId, v.reason));
export const useOpenInventory = (clinicId: string) => useE8Mutation((v: { unitId: string; data: api.InventoryOpenInput }) => api.openInventory(clinicId, v.unitId, v.data));
export const useCountInventory = () => useE8Mutation((v: { inventoryId: string; lines: api.CountInput[] }) => api.countInventory(v.inventoryId, v.lines));
export const useFinishInventory = () => useE8Mutation((v: { inventoryId: string; zeroUncounted: boolean }) => api.finishInventory(v.inventoryId, v.zeroUncounted));
export const useReopenInventory = () => useE8Mutation((v: { inventoryId: string; reason: string }) => api.reopenInventory(v.inventoryId, v.reason));
export const useCancelInventory = () => useE8Mutation((v: { inventoryId: string; reason: string }) => api.cancelInventory(v.inventoryId, v.reason));
export const useApproveInventory = () => useE8Mutation((v: { inventoryId: string; note: string }) => api.approveInventory(v.inventoryId, v.note));
export const useSaveAlertSettings = (clinicId: string) => useE8Mutation((v: { settings: api.AlertSettings; reason: string }) => api.saveAlertSettings(clinicId, v.settings, v.reason));
