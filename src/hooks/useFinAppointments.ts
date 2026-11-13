// Hooks do Financeiro/Estoque · Entrega 4 (atendimento, kit, pacotes dos pacientes, consumo sem saldo). Mesmo padrão de useFinSales.ts / useStockMoves.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/lib/api/finAppointments";

const K = ["fin", "e4"] as const;
const on = (clinicId: string | null, extra = true) => Boolean(clinicId) && extra;

export const useApptContext = (clinicId: string | null, unitId: string | null, patientId: string | null, serviceId: string | null) =>
  useQuery({ queryKey: [...K, "context", clinicId, unitId, patientId, serviceId], queryFn: () => api.getApptContext(clinicId as string, unitId, patientId, serviceId), enabled: on(clinicId), staleTime: 0 });
export const useApptPatients = (clinicId: string | null, search: string, enabled = true) =>
  useQuery({ queryKey: [...K, "patients", clinicId, search], queryFn: () => api.searchApptPatients(clinicId as string, search), enabled: on(clinicId, enabled) });
export const useAppointments = (clinicId: string | null, f: api.ApptFilter, enabled = true) =>
  useQuery({ queryKey: [...K, "list", clinicId, f], queryFn: () => api.listAppointments(clinicId as string, f), enabled: on(clinicId, enabled) });
export const useAppointment = (id: string | null) =>
  useQuery({ queryKey: [...K, "detail", id], queryFn: () => api.getAppointment(id as string), enabled: Boolean(id), staleTime: 0 });
export const useApptKit = (id: string | null, enabled = true) =>
  useQuery({ queryKey: [...K, "kit", id], queryFn: () => api.getKit(id as string), enabled: Boolean(id) && enabled, staleTime: 0 });
export const usePatientPackages = (clinicId: string | null, f: api.PatientPackageFilter, enabled = true) =>
  useQuery({ queryKey: [...K, "packages", clinicId, f], queryFn: () => api.listPatientPackages(clinicId as string, f), enabled: on(clinicId, enabled) });
export const useShortfalls = (clinicId: string | null, f: { unitId?: string | null; status?: string }, enabled = true) =>
  useQuery({ queryKey: [...K, "shortfalls", clinicId, f], queryFn: () => api.listShortfalls(clinicId as string, f), enabled: on(clinicId, enabled) });

function useE4Mutation<TVars, TOut = unknown>(fn: (v: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  // Atendimento mexe em estoque (saldo, kardex), em pacotes, em vendas e no Histórico: invalida o grupo da Entrega 4, o do estoque (E3) e a auditoria.
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: K }), qc.invalidateQueries({ queryKey: ["fin", "e3"] }), qc.invalidateQueries({ queryKey: ["fin", "e2"] }), qc.invalidateQueries({ queryKey: ["fin", "audit"] })]),
  });
}

export const useSaveAppointment = (clinicId: string) => useE4Mutation((v: api.SaveApptInput) => api.saveAppointment(clinicId, v));
export const useCompleteAppointment = () => useE4Mutation((v: { id: string; lines: api.KitLineInput[] | null; note?: string }) => api.completeAppointment(v.id, v.lines, v.note));
export const useCorrectAppointment = () => useE4Mutation((v: { id: string; lines: api.KitLineInput[]; reason: string }) => api.correctAppointment(v.id, v.lines, v.reason));
export const useCancelAppointment = () => useE4Mutation((v: { id: string; reason: string }) => api.cancelAppointment(v.id, v.reason));
export const useSetParticipants = () => useE4Mutation((v: { id: string; participants: api.SaveApptInput["participants"]; reason?: string }) => api.setAppointmentParticipants(v.id, v.participants, v.reason));
export const useDeliverPackageItem = () => useE4Mutation((v: { itemId: string; qty: number; unitId?: string | null }) => api.deliverPackageItem(v.itemId, v.qty, v.unitId));
export const useReturnFromPatient = () => useE4Mutation((v: { movementId: string; qty: number; reason: string }) => api.returnFromPatient(v.movementId, v.qty, v.reason));
export const useResolveShortfall = () => useE4Mutation((v: { id: string; mode: "retro" | "adjust"; reason: string }) => api.resolveShortfall(v.id, v.mode, v.reason));
