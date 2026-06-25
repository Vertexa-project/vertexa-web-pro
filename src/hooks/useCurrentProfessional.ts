import { useQuery } from "@tanstack/react-query";

import { getCurrentProfessional, getProfileName, listClinicProfessionals } from "@/lib/api/profile";
import { qk } from "@/lib/queryKeys";
import { DEMO_PROFESSIONAL_PROFILE_ID } from "@/lib/session";

/**
 * Nome do profissional atuante (demo = Dra. Camila via env). Usado p/ saudação.
 * Sob auth real isto viria de auth.uid()/profiles (ver docs/PENDENCIAS.md #14).
 */
export const useCurrentProfessionalName = () =>
  useQuery({
    queryKey: qk.currentProfessional(DEMO_PROFESSIONAL_PROFILE_ID ?? "none"),
    queryFn: () => getProfileName(DEMO_PROFESSIONAL_PROFILE_ID as string),
    enabled: Boolean(DEMO_PROFESSIONAL_PROFILE_ID),
    staleTime: Infinity,
  });

/**
 * Registro do profissional atuante (professionals.id + clinic_id) — usado no cadastro
 * de paciente para isolar por clínica e vincular o profissional. Demo via env.
 */
export const useCurrentProfessional = () =>
  useQuery({
    queryKey: qk.currentProfessionalRecord(DEMO_PROFESSIONAL_PROFILE_ID ?? "none"),
    queryFn: () => getCurrentProfessional(DEMO_PROFESSIONAL_PROFILE_ID as string),
    enabled: Boolean(DEMO_PROFESSIONAL_PROFILE_ID),
    staleTime: Infinity,
  });

/** Profissionais da clínica (para atribuir compromissos na agenda). */
export const useClinicProfessionals = (clinicId: string | null | undefined) =>
  useQuery({
    queryKey: qk.clinicProfessionals(clinicId ?? "none"),
    queryFn: () => listClinicProfessionals(clinicId as string),
    enabled: Boolean(clinicId),
    staleTime: Infinity,
  });
