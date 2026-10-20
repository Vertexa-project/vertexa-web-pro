import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createSupplement,
  deleteSupplement,
  listPatientSupplements,
  updateSupplement,
  type CreateSupplementInput,
  type UpdateSupplementInput,
} from "@/lib/api/supplements";
import { useWriteGuard } from "@/hooks/useDisciplines";
import { qk } from "@/lib/queryKeys";

/** Lista de suplementos do paciente (autoria web; ordem = order_index, igual ao app). */
export const usePatientSupplements = (patientId: string) =>
  useQuery({
    queryKey: qk.patientSupplements(patientId),
    queryFn: () => listPatientSupplements(patientId),
    enabled: Boolean(patientId),
  });

// Suplementos = disciplina nutricionista (mapa do banco). Guard no hook (defesa em profundidade). (WP-DISC B3)
export const useCreateSupplement = (patientId: string) => {
  const qc = useQueryClient();
  const guard = useWriteGuard();
  return useMutation({
    mutationFn: (input: CreateSupplementInput) => {
      guard(input.kind === "medication" ? "medications" : "supplements");
      return createSupplement(input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.patientSupplements(patientId) }),
  });
};

export const useUpdateSupplement = (patientId: string) => {
  const qc = useQueryClient();
  const guard = useWriteGuard();
  return useMutation({
    // `kind` só serve ao guard da UI (a RLS decide); não é enviado ao banco (kind é imutável).
    mutationFn: ({ kind, ...input }: UpdateSupplementInput & { kind?: "supplement" | "medication" }) => {
      guard(kind === "medication" ? "medications" : "supplements");
      return updateSupplement(input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.patientSupplements(patientId) }),
  });
};

export const useDeleteSupplement = (patientId: string) => {
  const qc = useQueryClient();
  const guard = useWriteGuard();
  return useMutation({
    mutationFn: ({ id, kind }: { id: string; kind?: "supplement" | "medication" }) => {
      guard(kind === "medication" ? "medications" : "supplements");
      return deleteSupplement(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.patientSupplements(patientId) }),
  });
};
