import { useMutation } from "@tanstack/react-query";

import { createClinicWithOwner, type CreateClinicResult } from "@/lib/api/clinics";

/**
 * Cria a PRÓPRIA clínica do usuário logado (WP-ONBOARDING). Mutação enxuta: NÃO invalida a identidade
 * aqui de propósito — quem cria vê primeiro a confirmação + próximos passos e só então "entra no painel"
 * (a recarga da identidade é disparada nesse momento pelo componente). Assim nada é automatizado sem a
 * decisão da pessoa. Ver CreateClinicForm.
 */
export function useCreateOwnClinic() {
  return useMutation<CreateClinicResult, unknown, string>({
    mutationFn: (name: string) => createClinicWithOwner(name),
  });
}
