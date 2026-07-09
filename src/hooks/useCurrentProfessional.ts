import { useQuery } from "@tanstack/react-query";

import { listClinicProfessionals } from "@/lib/api/profile";
import { qk } from "@/lib/queryKeys";
import { useIdentity } from "@/hooks/useIdentity";

/**
 * Registro do profissional atuante (professionals.id + clinic_id + role) — usado no cadastro
 * de paciente, RBAC de UI, exports, etc. Deriva da fonte ÚNICA `useIdentity` (real|demo):
 * demo = pin de env; real = auth.uid() → profile → professional. Mesma forma de retorno de
 * antes (`{ data, isLoading }`) para não quebrar os consumidores.
 */
export const useCurrentProfessional = () => {
  const identity = useIdentity();
  return { data: identity.professional ?? undefined, isLoading: identity.status === "loading" };
};

/** Nome do profissional atuante (para saudação). Real = professional/email; demo = seed. */
export const useCurrentProfessionalName = () => {
  const identity = useIdentity();
  return { data: identity.displayName ?? null, isLoading: identity.status === "loading" };
};

/** Profissionais da clínica (para atribuir compromissos na agenda). */
export const useClinicProfessionals = (clinicId: string | null | undefined) =>
  useQuery({
    queryKey: qk.clinicProfessionals(clinicId ?? "none"),
    queryFn: () => listClinicProfessionals(clinicId as string),
    enabled: Boolean(clinicId),
    staleTime: Infinity,
  });
