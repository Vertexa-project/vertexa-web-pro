import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ensureClinicCampaigns, listBroadcasts, listCampaigns, listSendCounts, previewBroadcast, sendBroadcast, updateCampaign } from "@/lib/api/campaigns";
import type { BroadcastAudience } from "@/lib/domain/campaigns";
import { qk } from "@/lib/queryKeys";

export const useCampaigns = () => useQuery({ queryKey: qk.campaigns, queryFn: listCampaigns });
export const useCampaignSendCounts = () => useQuery({ queryKey: qk.campaignSends, queryFn: listSendCounts });
export const useBroadcasts = () => useQuery({ queryKey: qk.campaignBroadcasts, queryFn: listBroadcasts });

export const useEnsureCampaigns = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clinicId: string) => ensureClinicCampaigns(clinicId),
    onSuccess: (n) => (n > 0 ? qc.invalidateQueries({ queryKey: qk.campaigns }) : undefined),
  });
};

export const useUpdateCampaign = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateCampaign,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.campaigns }),
  });
};

export const usePreviewBroadcast = () =>
  useMutation({ mutationFn: (v: { clinicId: string; audience: BroadcastAudience; days: number | null }) => previewBroadcast(v.clinicId, v.audience, v.days) });

export const useSendBroadcast = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sendBroadcast,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.campaignBroadcasts }),
  });
};
