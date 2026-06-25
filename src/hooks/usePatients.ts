import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createPatient, getPatient, listPatients, type CreatePatientInput } from "@/lib/api/patients";
import { qk } from "@/lib/queryKeys";

export const useListPatients = () =>
  useQuery({ queryKey: qk.patients, queryFn: listPatients });

export const usePatient = (id: string) =>
  useQuery({ queryKey: qk.patient(id), queryFn: () => getPatient(id), enabled: Boolean(id) });

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
