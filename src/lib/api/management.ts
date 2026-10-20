import { supabase } from "@/lib/supabase";
import type { ManagementOverview, RosterPatient } from "@/lib/domain/management";

export async function getManagementOverview(clinicId: string, idleDays: number): Promise<ManagementOverview> {
  const { data, error } = await supabase.rpc("clinic_management_overview", { p_clinic: clinicId, p_idle_days: idleDays });
  if (error) throw error;
  return data as ManagementOverview;
}

export async function getProfessionalRoster(clinicId: string, professionalId: string): Promise<RosterPatient[]> {
  const { data, error } = await supabase.rpc("professional_roster", { p_clinic: clinicId, p_professional: professionalId });
  if (error) throw error;
  return (data ?? []) as RosterPatient[];
}

export async function transferPatients(input: { fromId: string; toId: string; patientIds: string[] | null; reason?: string }): Promise<{ moved: number; skipped: number }> {
  const { data, error } = await supabase.rpc("transfer_patients", {
    p_from: input.fromId, p_to: input.toId, p_patients: input.patientIds, p_reason: input.reason ?? null,
  });
  if (error) throw error;
  const r = data as { moved?: number; skipped?: number } | null;
  return { moved: Number(r?.moved ?? 0), skipped: Number(r?.skipped ?? 0) };
}
