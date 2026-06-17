import { useQuery } from "@tanstack/react-query";

import { listCampaigns } from "@/lib/api/campaigns";
import { qk } from "@/lib/queryKeys";

export const useCampaigns = () => useQuery({ queryKey: qk.campaigns, queryFn: listCampaigns });
