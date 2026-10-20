import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getManagementOverview, getProfessionalRoster, transferPatients } from "@/lib/api/management";

export const useManagementOverview = (clinicId: string | null, idleDays: number) =>
  useQuery({
    queryKey: ["management", "overview", clinicId, idleDays],
    queryFn: () => getManagementOverview(clinicId as string, idleDays),
    enabled: Boolean(clinicId),
  });

export const useProfessionalRoster = (clinicId: string | null, professionalId: string | null) =>
  useQuery({
    queryKey: ["management", "roster", clinicId, professionalId],
    queryFn: () => getProfessionalRoster(clinicId as string, professionalId as string),
    enabled: Boolean(clinicId && professionalId),
  });

export const useTransferPatients = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: transferPatients,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["management"] });
      void qc.invalidateQueries({ queryKey: ["patients"] });
    },
  });
};
