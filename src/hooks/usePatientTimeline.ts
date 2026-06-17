import { useQuery } from "@tanstack/react-query";

import { getPatientTimeline } from "@/lib/api/timeline";
import { qk } from "@/lib/queryKeys";

export const usePatientTimeline = (patientId: string) =>
  useQuery({
    queryKey: qk.patientTimeline(patientId),
    queryFn: () => getPatientTimeline(patientId),
    enabled: Boolean(patientId),
  });
