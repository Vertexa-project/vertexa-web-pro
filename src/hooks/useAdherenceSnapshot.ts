import { useQuery } from "@tanstack/react-query";

import { getAdherenceSnapshot } from "@/lib/api/adherence";
import { qk } from "@/lib/queryKeys";

export const useAdherenceSnapshot = (patientId: string) =>
  useQuery({
    queryKey: qk.adherenceSnapshot(patientId),
    queryFn: () => getAdherenceSnapshot(patientId),
    enabled: Boolean(patientId),
  });
