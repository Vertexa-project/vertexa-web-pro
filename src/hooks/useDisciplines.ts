import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  assignDiscipline,
  getMyDisciplines,
  listClinicProfessionalDisciplines,
  listDisciplines,
  revokeDiscipline,
} from "@/lib/api/disciplines";
import {
  canWriteSurface,
  derivePermissions,
  WriteForbiddenError,
  type DisciplinePermissions,
  type ScopedSurface,
} from "@/lib/domain/disciplines";
import { qk } from "@/lib/queryKeys";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";

/** Lista canônica de disciplinas (rótulos + administração). */
export const useDisciplinesList = () =>
  useQuery({ queryKey: qk.disciplinesList, queryFn: listDisciplines, staleTime: Infinity });

/** Disciplinas do profissional logado. */
export const useMyDisciplines = (professionalId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: qk.myDisciplines(professionalId ?? "none"),
    queryFn: () => getMyDisciplines(professionalId as string),
    enabled: enabled && Boolean(professionalId),
    staleTime: 60_000,
  });

/** Profissionais da clínica + disciplinas (para a tela de administração do admin). */
export const useClinicProfessionalDisciplines = (clinicId: string | null | undefined) =>
  useQuery({
    queryKey: qk.clinicDisciplines(clinicId ?? "none"),
    queryFn: () => listClinicProfessionalDisciplines(clinicId as string),
    enabled: Boolean(clinicId),
  });

/** Concede disciplina (admin). Invalida a equipe da clínica e as disciplinas do próprio. */
export function useAssignDiscipline(clinicId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { professionalId: string; discipline: string }) =>
      assignDiscipline(vars.professionalId, vars.discipline),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clinicDisciplines(clinicId ?? "none") });
      qc.invalidateQueries({ queryKey: ["disciplines", "mine"] });
    },
  });
}

/** Revoga disciplina (admin). */
export function useRevokeDiscipline(clinicId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { professionalId: string; discipline: string }) =>
      revokeDiscipline(vars.professionalId, vars.discipline),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clinicDisciplines(clinicId ?? "none") });
      qc.invalidateQueries({ queryKey: ["disciplines", "mine"] });
    },
  });
}

/**
 * Permissões de escrita do profissional logado, DERIVADAS por UNIÃO das suas disciplinas
 * no banco (professional_disciplines). Fonte ÚNICA de gating clínico da UI — nunca de
 * `professionals.type`.
 */
export function useDisciplinePermissions(): {
  perms: DisciplinePermissions;
  disciplines: string[];
  isLoading: boolean;
} {
  const { data: professional } = useCurrentProfessional();
  const query = useMyDisciplines(professional?.id ?? null);
  const disciplines = query.data ?? [];
  return { perms: derivePermissions(disciplines), disciplines, isLoading: query.isLoading };
}

/**
 * Guard para os MUTATION HOOKS de superfícies escopadas: lança WriteForbiddenError se a UNIÃO das
 * disciplinas não cobre a superfície — impede um caminho de escrita que só falharia no banco.
 */
export function useWriteGuard() {
  const { perms } = useDisciplinePermissions();
  return useCallback(
    (surface: ScopedSurface) => {
      if (!canWriteSurface(perms, surface)) throw new WriteForbiddenError(surface);
    },
    [perms],
  );
}
