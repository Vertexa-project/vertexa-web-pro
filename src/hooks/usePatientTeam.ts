import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  assignPatientProfessional,
  deactivatePatientLink,
  listPatientTeam,
  listPatientsWithoutActiveProfessional,
  reactivatePatientLink,
  type AssignPatientProfessionalInput,
  type LinkStatusChangeInput,
} from "@/lib/api/patientTeam";
import { qk } from "@/lib/queryKeys";

/** Vínculos da paciente — ativos E inativos. Única consulta do produto que enxerga inativo. */
export const usePatientTeam = (patientId: string) =>
  useQuery({
    queryKey: qk.patientTeam(patientId),
    queryFn: () => listPatientTeam(patientId),
    enabled: Boolean(patientId),
  });

/**
 * Invalidação depois de desativar/reativar. São TRÊS caches, e os três importam:
 *   · patientTeam  — a própria seção (o status e o carimbo mudaram);
 *   · patient(id)  — o header do perfil deriva de `getPatient`, que agora só mostra ativos;
 *   · patients     — a listagem mostra o responsável e o badge "sem responsável ativo".
 * Sem os dois últimos, a tela continuaria exibindo como responsável alguém que acabou de perder
 * o acesso — exatamente a incoerência que este WP existe para eliminar.
 */
function useLinkStatusMutation(
  patientId: string,
  mutationFn: (input: LinkStatusChangeInput) => Promise<string>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.patientTeam(patientId) });
      void qc.invalidateQueries({ queryKey: qk.patient(patientId) });
      void qc.invalidateQueries({ queryKey: qk.patients });
    },
  });
}

export const useDeactivatePatientLink = (patientId: string) =>
  useLinkStatusMutation(patientId, deactivatePatientLink);

export const useReactivatePatientLink = (patientId: string) =>
  useLinkStatusMutation(patientId, reactivatePatientLink);

/** Atribuição via RPC. Invalida equipe, ficha, listagem e o catálogo da clínica (elegíveis). */
export function useAssignPatientProfessional(patientId: string, clinicId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignPatientProfessionalInput) => assignPatientProfessional(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.patientTeam(patientId) });
      void qc.invalidateQueries({ queryKey: qk.patient(patientId) });
      void qc.invalidateQueries({ queryKey: qk.patients });
      if (clinicId) {
        void qc.invalidateQueries({ queryKey: qk.clinicDisciplines(clinicId) });
        void qc.invalidateQueries({ queryKey: qk.patientsWithoutProfessional(clinicId) });
      }
    },
  });
}

/**
 * Pacientes sem responsável ativo, da CLÍNICA (uma chamada, não uma por paciente).
 * `enabled` deve refletir o sinal de admin: a RPC é admin-only e responde 42501 para os demais —
 * não vale a pena disparar uma consulta que já se sabe que será recusada.
 */
export const usePatientsWithoutActiveProfessional = (clinicId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: qk.patientsWithoutProfessional(clinicId ?? "none"),
    queryFn: () => listPatientsWithoutActiveProfessional(clinicId as string),
    enabled: Boolean(clinicId) && enabled,
    staleTime: 60_000,
  });
