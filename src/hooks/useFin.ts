// Hooks do módulo Financeiro/Estoque (Entrega 1): react-query sobre src/lib/api/fin*.ts e stockItems.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useClinicBrand } from "@/hooks/useClinicBrand";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import * as catalog from "@/lib/api/finCatalog";
import * as pros from "@/lib/api/finProfessionals";
import * as registry from "@/lib/api/finRegistry";
import * as stock from "@/lib/api/stockItems";
import { NO_FIN_ACCESS, type FinAccess } from "@/lib/domain/finAccess";

const K = ["fin"] as const;

/** Clínica do profissional logado (todas as telas do módulo). */
export function useFinClinicId(): string | null {
  const brand = useClinicBrand();
  const { data } = useCurrentProfessional();
  return brand.data?.clinicId ?? data?.clinicId ?? null;
}

/** Clínica + acesso do chamador (fail-closed enquanto carrega). */
export function useFinContext(): { clinicId: string | null; access: FinAccess; isLoading: boolean } {
  const clinicId = useFinClinicId();
  const { access, isLoading } = useFinAccess(clinicId);
  return { clinicId, access, isLoading };
}

export function useFinAccess(clinicId: string | null): { access: FinAccess; isLoading: boolean } {
  const q = useQuery({ queryKey: [...K, "access", clinicId], queryFn: () => registry.getFinAccess(clinicId as string), enabled: Boolean(clinicId), staleTime: 60_000 });
  // fail-closed: carregando ou erro = sem acesso
  return { access: q.data ?? NO_FIN_ACCESS, isLoading: q.isLoading };
}

const enabled = (clinicId: string | null, on = true) => Boolean(clinicId) && on;

export const useUnits = (clinicId: string | null, on = true) =>
  useQuery({ queryKey: [...K, "units", clinicId], queryFn: () => registry.listUnits(clinicId as string), enabled: enabled(clinicId, on) });
export const useStaffRoles = (clinicId: string | null, on = true) =>
  useQuery({ queryKey: [...K, "staffRoles", clinicId], queryFn: () => registry.listStaffRoles(clinicId as string), enabled: enabled(clinicId, on) });
export const useAudit = (clinicId: string | null, filter: registry.AuditFilter, on = true) =>
  useQuery({ queryKey: [...K, "audit", clinicId, filter], queryFn: () => registry.listAudit(clinicId as string, filter), enabled: enabled(clinicId, on) });
export const useFinSettings = (clinicId: string | null, on = true) =>
  useQuery({ queryKey: [...K, "settings", clinicId], queryFn: () => registry.getFinSettings(clinicId as string), enabled: enabled(clinicId, on) });
export const useTaxRates = (clinicId: string | null, on = true) =>
  useQuery({ queryKey: [...K, "taxRates", clinicId], queryFn: () => registry.listTaxRates(clinicId as string), enabled: enabled(clinicId, on) });
/** Alíquota efetiva do mês (servidor: fin_effective_tax_rate) — com `inherited` e o mês de origem. */
export const useEffectiveTaxRate = (clinicId: string | null, period: string, unitId: string | null, on = true) =>
  useQuery({ queryKey: [...K, "taxEffective", clinicId, period, unitId], queryFn: () => registry.getEffectiveTaxRate(clinicId as string, period, unitId), enabled: enabled(clinicId, on) });
export const useServices = (clinicId: string | null, on = true) =>
  useQuery({ queryKey: [...K, "services", clinicId], queryFn: () => catalog.listServices(clinicId as string), enabled: enabled(clinicId, on) });
export const usePackages = (clinicId: string | null, on = true) =>
  useQuery({ queryKey: [...K, "packages", clinicId], queryFn: () => catalog.listPackages(clinicId as string), enabled: enabled(clinicId, on) });
export const useAcquirers = (clinicId: string | null, on = true) =>
  useQuery({ queryKey: [...K, "acquirers", clinicId], queryFn: () => catalog.listAcquirers(clinicId as string), enabled: enabled(clinicId, on) });
export const useProFinanceList = (clinicId: string | null, on = true) =>
  useQuery({ queryKey: [...K, "proFinance", clinicId], queryFn: () => pros.listProFinance(clinicId as string), enabled: enabled(clinicId, on) });
export const useProFinanceDetail = (professionalId: string | null) =>
  useQuery({ queryKey: [...K, "proFinanceDetail", professionalId], queryFn: () => pros.getProFinance(professionalId as string), enabled: Boolean(professionalId), staleTime: 0, gcTime: 0 });
export const useStockItems = (clinicId: string | null, on = true) =>
  useQuery({ queryKey: [...K, "stockItems", clinicId], queryFn: () => stock.listStockItems(clinicId as string), enabled: enabled(clinicId, on) });

function useFinMutation<TVars>(fn: (v: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: K }) });
}

export const useSaveUnit = (clinicId: string) => useFinMutation((v: registry.SaveUnitInput) => registry.saveUnit(clinicId, v));
export const useSetStaffRoles = (clinicId: string) =>
  useFinMutation((v: { professionalId: string; roles: registry.StaffRoleInput[]; reason?: string }) => registry.setStaffRoles(clinicId, v.professionalId, v.roles, v.reason));
export const useSaveFinSettings = (clinicId: string) =>
  useFinMutation((v: { patch: Partial<Omit<registry.FinSettings, "clinic_id">>; reason?: string }) => registry.saveFinSettings(clinicId, v.patch, v.reason));
export const useSetTaxRate = (clinicId: string) =>
  useFinMutation((v: { period: string; ratePct: number; unitId: string | null; reason?: string }) => registry.setTaxRate(clinicId, v.period, v.ratePct, v.unitId, v.reason));
export const useSaveService = (clinicId: string) => useFinMutation((v: catalog.SaveServiceInput) => catalog.saveService(clinicId, v));
export const useSavePackage = (clinicId: string) => useFinMutation((v: catalog.SavePackageInput) => catalog.savePackage(clinicId, v));
export const useSaveAcquirer = (clinicId: string) => useFinMutation((v: catalog.SaveAcquirerInput) => catalog.saveAcquirer(clinicId, v));
export const useSaveProFinance = () => useFinMutation((v: pros.SaveProFinanceInput) => pros.saveProFinance(v));
export const useSaveStockItem = (clinicId: string) => useFinMutation((v: stock.SaveStockItemInput) => stock.saveStockItem(clinicId, v));
