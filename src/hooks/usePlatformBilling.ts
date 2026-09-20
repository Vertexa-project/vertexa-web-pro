import { useQuery } from "@tanstack/react-query";

import {
  getPlatformBillingOverview,
  getPlatformClinicBillingDetail,
  listPlatformBillingCharges,
  listPlatformBillingClinics,
  listPlatformBillingEvents,
  listPlatformBillingPayments,
} from "@/lib/api/platformBilling";
import type {
  PlatformBillingClinicFilters,
  PlatformBillingListFilters,
} from "@/lib/domain/platformBilling";
import { qk } from "@/lib/queryKeys";

export function usePlatformBillingOverview(enabled: boolean) {
  return useQuery({
    queryKey: qk.platformBillingOverview,
    queryFn: getPlatformBillingOverview,
    enabled,
    staleTime: 15_000,
  });
}

export function usePlatformBillingClinics(
  enabled: boolean,
  filters: PlatformBillingClinicFilters = {},
) {
  return useQuery({
    queryKey: qk.platformBillingClinics(filters),
    queryFn: () => listPlatformBillingClinics(filters),
    enabled,
    staleTime: 15_000,
  });
}

export function usePlatformClinicBillingDetail(clinicId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.platformClinicBillingDetail(clinicId ?? "none"),
    queryFn: () => getPlatformClinicBillingDetail(clinicId as string),
    enabled: Boolean(clinicId) && enabled,
    staleTime: 15_000,
  });
}

export function usePlatformBillingCharges(
  enabled: boolean,
  filters: PlatformBillingListFilters = {},
) {
  return useQuery({
    queryKey: qk.platformBillingCharges(filters),
    queryFn: () => listPlatformBillingCharges(filters),
    enabled,
    staleTime: 15_000,
  });
}

export function usePlatformBillingPayments(
  enabled: boolean,
  filters: PlatformBillingListFilters = {},
) {
  return useQuery({
    queryKey: qk.platformBillingPayments(filters),
    queryFn: () => listPlatformBillingPayments(filters),
    enabled,
    staleTime: 15_000,
  });
}

export function usePlatformBillingEvents(
  enabled: boolean,
  filters: PlatformBillingListFilters = {},
) {
  return useQuery({
    queryKey: qk.platformBillingEvents(filters),
    queryFn: () => listPlatformBillingEvents(filters),
    enabled,
    staleTime: 15_000,
  });
}
