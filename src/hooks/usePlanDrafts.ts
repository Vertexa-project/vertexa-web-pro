import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchDraftConfig, fetchPendingDraft, generatePlanDraft, resolvePlanDraft, saveDraftConfig, type DraftConfig } from "@/lib/api/planDrafts";
import type { PlanDraftKind } from "@/lib/domain/planDraft";
import { qk } from "@/lib/queryKeys";

export const usePendingPlanDraft = (patientId: string, kind: PlanDraftKind, enabled = true) =>
  useQuery({ queryKey: qk.aiPlanDraft(patientId, kind), queryFn: () => fetchPendingDraft(patientId, kind), enabled, staleTime: 15_000 });

export const usePlanDraftConfig = (clinicId: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: qk.planDraftConfig(clinicId ?? "none"), queryFn: () => fetchDraftConfig(clinicId as string), enabled: Boolean(clinicId) && enabled, staleTime: 60_000 });

export function useGeneratePlanDraft(patientId: string, kind: PlanDraftKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { patientType: string; notes: string }) => generatePlanDraft({ patientId, kind, ...v }),
    onSuccess: (r) => { qc.setQueryData(qk.aiPlanDraft(patientId, kind), r.draft); },
  });
}

export function useResolvePlanDraft(patientId: string, kind: PlanDraftKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { draftId: string; decision: "usado" | "descartado" }) => resolvePlanDraft(v.draftId, v.decision),
    // O rascunho sai da tela na hora (usado ou descartado); a busca depois confirma com o servidor.
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: qk.aiPlanDraft(patientId, kind) });
      qc.setQueryData(qk.aiPlanDraft(patientId, kind), null);
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: qk.aiPlanDraft(patientId, kind) }); },
  });
}

export function useSavePlanDraftConfig(clinicId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: DraftConfig) => saveDraftConfig(v),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.planDraftConfig(clinicId ?? "none") }); },
  });
}
