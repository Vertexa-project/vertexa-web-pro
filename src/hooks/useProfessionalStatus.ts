import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deactivateProfessional,
  listMyClinicMemberships,
  listProfessionalStatusEvents,
  reactivateProfessional,
} from "@/lib/api/professionalStatus";
import { qk } from "@/lib/queryKeys";

/**
 * Trilha de estado dos profissionais da clínica (quem desativou, quando, por quê).
 *
 * `enabled` explícito porque a RLS é admin-only: para o não-admin a consulta volta VAZIA, não
 * erra — e vazio, aqui, seria lido como "nunca ninguém foi desativado". Quem não é admin
 * simplesmente não faz a pergunta.
 */
export function useProfessionalStatusEvents(clinicId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.professionalStatusEvents(clinicId ?? "none"),
    queryFn: () => listProfessionalStatusEvents(clinicId as string),
    enabled: enabled && Boolean(clinicId),
    staleTime: 30_000,
  });
}

/**
 * O que precisa ser revalidado depois de desativar/reativar alguém. A desativação CASCATEIA no
 * servidor (vínculos viram histórico e o roster do chat perde a pessoa), então invalidar só a
 * lista de equipe deixaria a tela de pacientes mentindo até o próximo refetch.
 */
function invalidateAfterStatusChange(
  qc: ReturnType<typeof useQueryClient>,
  clinicId: string | null | undefined,
) {
  const id = clinicId ?? "none";
  qc.invalidateQueries({ queryKey: qk.clinicDisciplines(id) }); // a lista da equipe (status)
  qc.invalidateQueries({ queryKey: qk.professionalStatusEvents(id) }); // a trilha
  qc.invalidateQueries({ queryKey: ["patients"] }); // listagem + badge "sem responsável ativo"
  qc.invalidateQueries({ queryKey: ["patient"] }); // equipe da paciente e conversa
  qc.invalidateQueries({ queryKey: ["chat"] }); // roster do canal (seletor de @)
  qc.invalidateQueries({ queryKey: qk.myClinicMemberships }); // o próprio acesso, se for o caso
}

/** Desativa o profissional na clínica (admin). Ver a cascata em invalidateAfterStatusChange. */
export function useDeactivateProfessional(clinicId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { professionalId: string; reason: string | null }) =>
      deactivateProfessional(vars.professionalId, vars.reason),
    onSuccess: () => invalidateAfterStatusChange(qc, clinicId),
  });
}

/** Reativa o profissional na clínica (admin). NÃO religa vínculo — a assimetria é do banco. */
export function useReactivateProfessional(clinicId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { professionalId: string; reason: string | null }) =>
      reactivateProfessional(vars.professionalId, vars.reason),
    onSuccess: () => invalidateAfterStatusChange(qc, clinicId),
  });
}

/**
 * As clínicas do PRÓPRIO usuário e o status dele em cada uma. É a fonte da tela que explica uma
 * desativação — e a única leitura que sobra para quem foi cortado (ele perdeu `clinics_select`).
 *
 * `retry: false` de propósito: em erro a decisão é `unknown` e o painel abre (fail-open, ver
 * resolveClinicAccess). Insistir só atrasaria a montagem de quem está ativo.
 */
export function useMyClinicMemberships(enabled = true) {
  return useQuery({
    queryKey: qk.myClinicMemberships,
    queryFn: listMyClinicMemberships,
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}
