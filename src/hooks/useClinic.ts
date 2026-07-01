import { useQuery } from "@tanstack/react-query";

import { getClinic } from "@/lib/api/clinics";
import { qk } from "@/lib/queryKeys";

/** Clínica pelo id (nome p/ cabeçalho de relatório). Desabilitado sem clinicId. */
export const useClinic = (clinicId: string | null | undefined) =>
  useQuery({
    queryKey: qk.clinic(clinicId ?? "none"),
    queryFn: () => getClinic(clinicId as string),
    enabled: Boolean(clinicId),
    staleTime: Infinity,
  });
