import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ackJourneyMilestone,
  createJourneyColumn,
  deleteJourneyColumn,
  listJourneyColumns,
  listJourneyState,
  listMilestoneAcks,
  movePatientJourney,
  setInitialColumn,
  swapColumnPositions,
  updateJourneyColumn,
  type JourneyColumn,
  type JourneyColumnPatch,
  type MilestoneAck,
  type NewJourneyColumn,
} from "@/lib/api/journey";
import { applyMove, type JourneyStateMap } from "@/lib/domain/journeyBoard";
import { qk } from "@/lib/queryKeys";

/** Colunas da clínica (ordenadas). Desligado sem clinicId. */
export const useJourneyColumns = (clinicId: string | null | undefined) =>
  useQuery({
    queryKey: qk.journeyColumns(clinicId ?? "none"),
    queryFn: () => listJourneyColumns(clinicId as string),
    enabled: Boolean(clinicId),
    staleTime: 60_000,
  });

/** Estado atual (patient_id → column_id). Global — a RLS escopa aos pacientes acessíveis. */
export const useJourneyState = (enabled = true) =>
  useQuery({ queryKey: qk.journeyState, queryFn: listJourneyState, enabled, staleTime: 30_000 });

/** Marcos reconhecidos (patient_id + key). */
export const useMilestoneAcks = (enabled = true) =>
  useQuery({ queryKey: qk.journeyAcks, queryFn: listMilestoneAcks, enabled, staleTime: 30_000 });

/**
 * MOVER paciente de coluna com ATUALIZAÇÃO OTIMISTA + REVERSÃO. onMutate aplica o move no cache na
 * hora (o cartão "anda" imediatamente); onError restaura o snapshot (o cartão volta) — cobre o caso
 * do EXTERNO/não-vinculado que o banco recusa (42501) ou do vínculo removido. onSettled reconcilia
 * com o servidor (fonte da verdade).
 */
export function useMovePatientJourney() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { patientId: string; toColumnId: string; fromColumnId: string | null }) =>
      movePatientJourney(vars.patientId, vars.toColumnId),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: qk.journeyState });
      const previous = qc.getQueryData<JourneyStateMap>(qk.journeyState);
      // Guarda só o valor ANTERIOR DESTE paciente (undefined = derivado/sem estado). A reversão é
      // ESCOPADA a ele — não restaura o mapa inteiro, para não desfazer outro move otimista
      // concorrente no mesmo cache (dois arrastos rápidos, o primeiro falhando).
      const prevValue = previous?.[vars.patientId];
      qc.setQueryData<JourneyStateMap>(qk.journeyState, (cur) =>
        applyMove(cur ?? {}, vars.patientId, vars.toColumnId),
      );
      return { prevValue };
    },
    onError: (_err, vars, context) => {
      qc.setQueryData<JourneyStateMap>(qk.journeyState, (cur) => {
        const next = { ...(cur ?? {}) };
        if (context?.prevValue === undefined) delete next[vars.patientId];
        else next[vars.patientId] = context.prevValue;
        return next;
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.journeyState });
    },
  });
}

/** RECONHECER marco (otimista: o selo muda de aparência na hora; reverte se a RPC falhar). */
export function useAckMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { patientId: string; milestoneKey: string }) =>
      ackJourneyMilestone(vars.patientId, vars.milestoneKey),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: qk.journeyAcks });
      const previous = qc.getQueryData<MilestoneAck[]>(qk.journeyAcks) ?? [];
      const already = previous.some((a) => a.patientId === vars.patientId && a.key === vars.milestoneKey);
      if (!already) {
        qc.setQueryData<MilestoneAck[]>(qk.journeyAcks, [
          ...previous,
          { patientId: vars.patientId, key: vars.milestoneKey },
        ]);
      }
      // Reverte só o que ESTE ack adicionou (nada, se já existia) — não desfaz acks concorrentes.
      return { added: !already };
    },
    onError: (_err, vars, context) => {
      if (context?.added) {
        qc.setQueryData<MilestoneAck[]>(qk.journeyAcks, (cur) =>
          (cur ?? []).filter((a) => !(a.patientId === vars.patientId && a.key === vars.milestoneKey)),
        );
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.journeyAcks });
    },
  });
}

// ===== Administração de colunas (admin) =====

function useColumnsInvalidator(clinicId: string | null | undefined) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: qk.journeyColumns(clinicId ?? "none") });
}

export function useCreateJourneyColumn(clinicId: string | null | undefined) {
  const invalidate = useColumnsInvalidator(clinicId);
  return useMutation({ mutationFn: (input: NewJourneyColumn) => createJourneyColumn(input), onSuccess: invalidate });
}

export function useUpdateJourneyColumn(clinicId: string | null | undefined) {
  const invalidate = useColumnsInvalidator(clinicId);
  return useMutation({
    mutationFn: (vars: { id: string; patch: JourneyColumnPatch }) => updateJourneyColumn(vars.id, vars.patch),
    onSuccess: invalidate,
  });
}

export function useDeleteJourneyColumn(clinicId: string | null | undefined) {
  const invalidate = useColumnsInvalidator(clinicId);
  return useMutation({ mutationFn: (id: string) => deleteJourneyColumn(id), onSuccess: invalidate });
}

export function useSetInitialColumn(clinicId: string | null | undefined) {
  const invalidate = useColumnsInvalidator(clinicId);
  return useMutation({
    mutationFn: (columnId: string) => setInitialColumn(clinicId as string, columnId),
    // onSettled (não onSuccess): reconcilia a lista mesmo em erro, para o estado real (inclusive um
    // eventual "zero inicial") ficar visível ao admin em vez de mostrar a lista desatualizada.
    onSettled: invalidate,
  });
}

export function useSwapColumns(clinicId: string | null | undefined) {
  const invalidate = useColumnsInvalidator(clinicId);
  return useMutation({
    mutationFn: (vars: { a: JourneyColumn; b: JourneyColumn }) =>
      swapColumnPositions(
        { id: vars.a.id, position: vars.a.position },
        { id: vars.b.id, position: vars.b.position },
      ),
    onSuccess: invalidate,
  });
}
