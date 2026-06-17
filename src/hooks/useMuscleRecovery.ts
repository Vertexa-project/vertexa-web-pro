import { useQuery } from "@tanstack/react-query";

import { getMuscleRecovery } from "@/lib/api/recovery";
import { qk } from "@/lib/queryKeys";

export const useMuscleRecovery = (patientId: string) =>
  useQuery({
    queryKey: qk.muscleRecovery(patientId),
    queryFn: () => getMuscleRecovery(patientId),
    enabled: Boolean(patientId),
  });
