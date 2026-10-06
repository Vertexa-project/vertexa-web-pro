import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPatient,
  getPatient,
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
