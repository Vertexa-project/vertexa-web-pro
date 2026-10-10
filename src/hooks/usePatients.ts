import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPatient,
  deleteUnusedPatientRegistration,
  getPatient,
  getPatientDeletionEligibility,
  getPatientRegistrationAccess,
  listPatients,
  updatePatientRegistration,
  type CreatePatientInput,
  type UpdatePatientRegistrationInput,
} from "@/lib/api/patients";
import { qk } from "@/lib/queryKeys";

export const useListPatients = () =>
  useQuery({ queryKey: qk.patients, queryFn: listPatients });

export const usePatient = (id: string) =>
  useQuery({ queryKey: qk.patient(id), queryFn: () => getPatient(id), enabled: Boolean(id) });

/** Estado de acesso do paciente (admin-only). Só consulta quando `enabled` (diálogo aberto). */
export const usePatientRegistrationAccess = (patientId: string, enabled: boolean) =>
  useQuery({
    queryKey: qk.patientRegistrationAccess(patientId),
    queryFn: () => getPatientRegistrationAccess(patientId),
    enabled: Boolean(patientId) && enabled,
    staleTime: 0,
  });

/** Edita o cadastro (RPC canônica). Atualiza ficha e lista sem reload manual. */
export const useUpdatePatientRegistration = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePatientRegistrationInput) => updatePatientRegistration(input),
    onSuccess: (_res, input) => {
      qc.invalidateQueries({ queryKey: qk.patient(input.patientId) });
      qc.invalidateQueries({ queryKey: qk.patients });
    },
  });
};

/** Elegibilidade de exclusão (admin-only). Só consulta quando `enabled` (diálogo aberto). */
export const usePatientDeletionEligibility = (patientId: string, enabled: boolean) =>
  useQuery({
    queryKey: qk.patientDeletionEligibility(patientId),
    queryFn: () => getPatientDeletionEligibility(patientId),
    enabled: Boolean(patientId) && enabled,
    staleTime: 0,
  });

/**
 * Exclui cadastro não utilizado (RPC canônica). Só invalida a lista (o paciente some sem reload).
 *
 * O cache `["patient", id, ...]` NÃO é removido aqui: com `v7_startTransition` a navegação de saída
 * é uma transição, então a ficha ainda re-renderiza uma vez (fechamento do diálogo, urgente) antes
 * de desmontar — se a query sumisse agora, o `useQuery` montado buscaria de novo o paciente
 * excluído (406 do `.single()`). Quem descarta esse cache é a própria ficha, ao desmontar.
 */
export const useDeleteUnusedPatientRegistration = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patientId: string) => deleteUnusedPatientRegistration(patientId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.patients });
    },
  });
};

/** Cadastra um paciente de verdade no banco. Retorna o id do novo paciente. */
export const useCreatePatient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePatientInput) => createPatient(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.patients });
    },
  });
};
