import { useQuery } from "@tanstack/react-query";

import {
  getMyClinicBillingOverview,
  listMyClinicBillingCharges,
  listMyClinicBillingPayments,
  listMyClinicBillingTimeline,
} from "@/lib/api/billingHub";
import { qk } from "@/lib/queryKeys";

export function useClinicBillingOverview(clinicId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.clinicBillingOverview(clinicId ?? "none"),
    queryFn: () => getMyClinicBillingOverview(clinicId as string),
    enabled: Boolean(clinicId) && enabled,
    staleTime: 15_000,
  });
}

export function useClinicBillingCharges(clinicId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.clinicBillingCharges(clinicId ?? "none"),
    queryFn: () => listMyClinicBillingCharges(clinicId as string),
    enabled: Boolean(clinicId) && enabled,
    staleTime: 15_000,
  });
}

export function useClinicBillingPayments(clinicId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.clinicBillingPayments(clinicId ?? "none"),
    queryFn: () => listMyClinicBillingPayments(clinicId as string),
    enabled: Boolean(clinicId) && enabled,
    staleTime: 15_000,
  });
}

export function useClinicBillingTimeline(clinicId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.clinicBillingTimeline(clinicId ?? "none"),
    queryFn: () => listMyClinicBillingTimeline(clinicId as string),
    enabled: Boolean(clinicId) && enabled,
    staleTime: 15_000,
  });
}
