import { useQuery } from "@tanstack/react-query";

import { getMessages } from "@/lib/api/messages";
import { qk } from "@/lib/queryKeys";

export const useMessages = (patientId: string) =>
  useQuery({
    queryKey: qk.messages(patientId),
    queryFn: () => getMessages(patientId),
    enabled: Boolean(patientId),
  });
