import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cancelCharge, generateMonthCharges, getFinanceCharges, getFinanceOverview, getFinancePatients, markChargePaid, reopenCharge, setPatientBilling } from "@/lib/api/finance";

const KEY = ["finance"] as const;
export const useFinanceOverview = (clinicId: string | null, month: string) =>
  useQuery({ queryKey: [...KEY, "overview", clinicId, month], queryFn: () => getFinanceOverview(clinicId as string, month), enabled: Boolean(clinicId) });
export const useFinanceCharges = (clinicId: string | null, month: string) =>
  useQuery({ queryKey: [...KEY, "charges", clinicId, month], queryFn: () => getFinanceCharges(clinicId as string, month), enabled: Boolean(clinicId) });
export const useFinancePatients = (clinicId: string | null) =>
  useQuery({ queryKey: [...KEY, "patients", clinicId], queryFn: () => getFinancePatients(clinicId as string), enabled: Boolean(clinicId) });

function useInvalidating<TVars>(fn: (v: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: KEY }) });
}
export const useGenerateCharges = () => useInvalidating((v: { clinicId: string; month: string }) => generateMonthCharges(v.clinicId, v.month));
export const useSetBilling = () => useInvalidating(setPatientBilling);
export const useMarkPaid = () => useInvalidating((id: string) => markChargePaid(id));
export const useReopenCharge = () => useInvalidating((id: string) => reopenCharge(id));
export const useCancelCharge = () => useInvalidating((id: string) => cancelCharge(id));
