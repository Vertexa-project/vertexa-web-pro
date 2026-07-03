import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createSupplement,
  deleteSupplement,
  listPatientSupplements,
  updateSupplement,
  type CreateSupplementInput,
  type UpdateSupplementInput,
} from "@/lib/api/supplements";
import { qk } from "@/lib/queryKeys";

/** Lista de suplementos do paciente (autoria web; ordem = order_index, igual ao app). */
export const usePatientSupplements = (patientId: string) =>
  useQuery({
    queryKey: qk.patientSupplements(patientId),
    queryFn: () => listPatientSupplements(patientId),
    enabled: Boolean(patientId),
  });

export const useCreateSupplement = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSupplementInput) => createSupplement(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.patientSupplements(patientId) }),
  });
};

export const useUpdateSupplement = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSupplementInput) => updateSupplement(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.patientSupplements(patientId) }),
  });
};

export const useDeleteSupplement = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSupplement(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.patientSupplements(patientId) }),
  });
};
