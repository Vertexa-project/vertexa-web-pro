import { useQuery } from "@tanstack/react-query";

import { amIClinicAdmin } from "@/lib/api/clinicAdmin";
import { resolveClinicAdmin } from "@/lib/domain/clinicAdmin";
import { qk } from "@/lib/queryKeys";

export interface ClinicAdminSignal {
  /** É admin da clínica pelo SINAL REAL do banco (fail-closed). */
  isClinicAdmin: boolean;
  /** A resposta ainda está carregando. */
  isLoading: boolean;
  /** A consulta falhou (tratado como NÃO-admin). */
  isError: boolean;
}

/**
 * "Sou admin da clínica?" pelo SINAL REAL do banco (RPC public.am_i_clinic_admin = dono OU
 * clinic_role='admin'), NÃO por profiles.role (corrige AUTH-ADMIN-1). Com cache (react-query).
 * FAIL-CLOSED — undefined/erro ⇒ NÃO-admin (nunca abre a área "no escuro").
 * `clinicId` opcional: ausente ⇒ o servidor resolve a clínica do logado.
 */
export function useIsClinicAdmin(clinicId?: string | null): ClinicAdminSignal {
  const query = useQuery({
    queryKey: qk.clinicAdmin(clinicId ?? null),
    queryFn: () => amIClinicAdmin(clinicId ?? null),
    staleTime: 5 * 60_000,
  });

  return {
    isClinicAdmin: resolveClinicAdmin({ data: query.data, isError: query.isError }),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
