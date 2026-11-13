// Hooks do Estoque · Entrega 3 (saldo, entradas, saídas, movimentações). Mesmo padrão de useFinSales.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/lib/api/stockMoves";

const K = ["fin", "e3"] as const;
const on = (clinicId: string | null, extra = true) => Boolean(clinicId) && extra;

export const useBalances = (clinicId: string | null, f: api.BalanceFilter, enabled = true) =>
  useQuery({ queryKey: [...K, "balances", clinicId, f], queryFn: () => api.listBalances(clinicId as string, f), enabled: on(clinicId, enabled) });
export const useMovements = (clinicId: string | null, f: api.MovementFilter, enabled = true) =>
  useQuery({ queryKey: [...K, "movements", clinicId, f], queryFn: () => api.listMovements(clinicId as string, f), enabled: on(clinicId, enabled) });
export const useEntries = (clinicId: string | null, f: api.EntryFilter, enabled = true) =>
  useQuery({ queryKey: [...K, "entries", clinicId, f], queryFn: () => api.listEntries(clinicId as string, f), enabled: on(clinicId, enabled) });
export const useSuppliers = (clinicId: string | null, enabled = true) =>
  useQuery({ queryKey: [...K, "suppliers", clinicId], queryFn: () => api.listSuppliers(clinicId as string), enabled: on(clinicId, enabled) });
export const useSupplierMaps = (supplierId: string | null) =>
  useQuery({ queryKey: [...K, "maps", supplierId], queryFn: () => api.listSupplierMaps(supplierId as string), enabled: Boolean(supplierId), staleTime: 0 });
export const useStockLots = (clinicId: string | null, unitId: string | null, itemId: string | null) =>
  useQuery({ queryKey: [...K, "lots", clinicId, unitId, itemId], queryFn: () => api.getLots(clinicId as string, unitId as string, itemId as string), enabled: on(clinicId, Boolean(unitId && itemId)), staleTime: 0 });
export const useStockPatients = (clinicId: string | null, search: string, enabled = true) =>
  useQuery({ queryKey: [...K, "patients", clinicId, search], queryFn: () => api.searchStockPatients(clinicId as string, search), enabled: on(clinicId, enabled) });

function useE3Mutation<TVars, TOut = unknown>(fn: (v: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  // Qualquer movimentação mexe em saldo, kardex, entradas e no Histórico: invalida o grupo da Entrega 3 e a auditoria da Entrega 1.
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: K }), qc.invalidateQueries({ queryKey: ["fin", "audit"] })]) });
}

export const useCreateEntry = (clinicId: string) =>
  useE3Mutation((v: { unitId: string; header: api.EntryHeaderInput; lines: import("@/lib/domain/nfe").EntryLineInput[] }) => api.createEntry(clinicId, v.unitId, v.header, v.lines));
export const useRegisterExit = (clinicId: string) => useE3Mutation((v: api.ExitInput) => api.registerExit(clinicId, v));
export const useReverseMovement = () => useE3Mutation((v: { movementId: string; reason: string }) => api.reverseMovement(v.movementId, v.reason));
export const useReverseEntry = () => useE3Mutation((v: { entryId: string; reason: string }) => api.reverseEntry(v.entryId, v.reason));

export const useEntryByKey = (clinicId: string | null, key: string | null) =>
  useQuery({ queryKey: [...K, "byKey", clinicId, key], queryFn: () => api.findActiveEntryByKey(clinicId as string, key as string), enabled: on(clinicId, Boolean(key)), staleTime: 0 });
