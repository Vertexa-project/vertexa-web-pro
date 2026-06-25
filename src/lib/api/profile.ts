import { supabase } from "@/lib/supabase";
import type { ProfessionalType } from "@/types/db";

/** Nome (full_name) de um profile pelo id. Usado p/ saudar o profissional atuante. */
export async function getProfileName(profileId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw error;
  return (data as { full_name: string | null } | null)?.full_name ?? null;
}

/**
 * Registro do profissional atuante (demo = Dra. Camila via env). Resolve professionals.id
 * + clinic_id a partir do profile_id — necessário para CADASTRAR paciente com isolamento
 * por clínica e vinculá-lo ao profissional. Sob auth real viria de auth.uid() (PENDENCIAS #14).
 */
export interface CurrentProfessional {
  id: string; // professionals.id (para o vínculo)
  profileId: string;
  clinicId: string | null; // clínica do profissional (isolamento)
  fullName: string | null;
  type: ProfessionalType;
}

interface RawProfessionalRow {
  id: string;
  profile_id: string | null;
  clinic_id: string | null;
  type: ProfessionalType;
  profile: { full_name: string | null } | null;
}

export async function getCurrentProfessional(profileId: string): Promise<CurrentProfessional | null> {
  const { data, error } = await supabase
    .from("professionals")
    .select("id, profile_id, clinic_id, type, profile:profiles ( full_name )")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as RawProfessionalRow;
  return {
    id: row.id,
    profileId: row.profile_id ?? profileId,
    clinicId: row.clinic_id,
    fullName: row.profile?.full_name ?? null,
    type: row.type,
  };
}

/** Resumo de um profissional para selects (ex.: atribuir um compromisso da agenda). */
export interface ClinicProfessional {
  id: string;
  fullName: string | null;
  type: ProfessionalType;
}

/** Profissionais de uma clínica (para o select de compromisso). Escopado por clinic_id. */
export async function listClinicProfessionals(clinicId: string): Promise<ClinicProfessional[]> {
  const { data, error } = await supabase
    .from("professionals")
    .select("id, type, profile:profiles ( full_name )")
    .eq("clinic_id", clinicId);
  if (error) throw error;
  return ((data ?? []) as unknown as RawProfessionalRow[]).map((r) => ({
    id: r.id,
    fullName: r.profile?.full_name ?? null,
    type: r.type,
  }));
}
