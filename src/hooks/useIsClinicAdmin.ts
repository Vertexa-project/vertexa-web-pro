import { useQuery } from "@tanstack/react-query";

import { amIClinicAdmin } from "@/lib/api/clinicAdmin";
import { resolveClinicAdmin } from "@/lib/domain/clinicAdmin";
import { qk } from "@/lib/queryKeys";
import { useAuth } from "@/providers/auth-context";
import { useRole } from "@/providers/role-context";

export interface ClinicAdminSignal {
  /** É admin da clínica pelo SINAL REAL do banco (fail-closed). */
  isClinicAdmin: boolean;
  /** A resposta ainda está carregando (real mode). */
  isLoading: boolean;
  /** A consulta falhou (tratado como NÃO-admin). */
  isError: boolean;
}

/**
 * "Sou admin da clínica?" pelo SINAL REAL do banco (RPC public.am_i_clinic_admin = dono OU
 * clinic_role='admin'), NÃO por profiles.role (corrige AUTH-ADMIN-1). Com cache (react-query).
 * - Real: FAIL-CLOSED — undefined/erro ⇒ NÃO-admin (nunca abre a área "no escuro").
 * - Demo: sem sessão real; usa a persona do seletor (perms.isAdmin) para demonstrações ao vivo.
 * `clinicId` opcional: ausente ⇒ o servidor resolve a clínica do logado.
 */
export function useIsClinicAdmin(clinicId?: string | null): ClinicAdminSignal {
  const { demoMode } = useAuth();
  const { perms } = useRole();

  const query = useQuery({
    queryKey: qk.clinicAdmin(clinicId ?? null),
    queryFn: () => amIClinicAdmin(clinicId ?? null),
    enabled: !demoMode,
    staleTime: 5 * 60_000,
  });

  const isClinicAdmin = resolveClinicAdmin({
    demoMode,
    demoIsAdmin: perms.isAdmin,
    data: query.data,
    isError: query.isError,
  });

  return {
    isClinicAdmin,
    isLoading: demoMode ? false : query.isLoading,
    isError: demoMode ? false : query.isError,
  };
}
