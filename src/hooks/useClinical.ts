import { useQuery } from "@tanstack/react-query";

import {
  getEncounter,
  getPeople,
  getRecord,
  listAgreementSends,
  listChunks,
  listEncounters,
  listSegments,
  listVersions,
} from "@/lib/api/clinical";

export const clinicalKeys = {
  encounters: (patientId: string) => ["clinical", "encounters", patientId] as const,
  encounter: (id: string) => ["clinical", "encounter", id] as const,
  record: (id: string) => ["clinical", "record", id] as const,
  segments: (id: string) => ["clinical", "segments", id] as const,
  chunks: (id: string) => ["clinical", "chunks", id] as const,
  people: (id: string) => ["clinical", "people", id] as const,
  versions: (id: string) => ["clinical", "versions", id] as const,
  sends: (id: string) => ["clinical", "sends", id] as const,
  all: (id: string) => ["clinical", "all", id] as const,
};

const POLL_MS = 3000;

export const useEncounters = (patientId: string) =>
  useQuery({ queryKey: clinicalKeys.encounters(patientId), queryFn: () => listEncounters(patientId), enabled: !!patientId });

export const useEncounter = (id: string, live: boolean) =>
  useQuery({
    queryKey: clinicalKeys.encounter(id),
    queryFn: () => getEncounter(id),
    enabled: !!id,
    refetchInterval: live ? POLL_MS : false,
  });

export const useRecord = (id: string, live: boolean) =>
  useQuery({ queryKey: clinicalKeys.record(id), queryFn: () => getRecord(id), enabled: !!id, refetchInterval: live ? POLL_MS : false });

export const useSegments = (id: string, live: boolean) =>
  useQuery({ queryKey: clinicalKeys.segments(id), queryFn: () => listSegments(id), enabled: !!id, refetchInterval: live ? POLL_MS : false });

export const useChunks = (id: string, live: boolean) =>
  useQuery({ queryKey: clinicalKeys.chunks(id), queryFn: () => listChunks(id), enabled: !!id, refetchInterval: live ? POLL_MS : false });

export const usePeople = (id: string, refresh: unknown) =>
  useQuery({ queryKey: [...clinicalKeys.people(id), refresh], queryFn: () => getPeople(id), enabled: !!id });

export const useVersions = (id: string, enabled: boolean) =>
  useQuery({ queryKey: clinicalKeys.versions(id), queryFn: () => listVersions(id), enabled: !!id && enabled });

export const useAgreementSends = (id: string) =>
  useQuery({ queryKey: clinicalKeys.sends(id), queryFn: () => listAgreementSends(id), enabled: !!id });
