// Superfície pública de Platform Admin (WP-10B2B).
// A autoridade REAL é o banco: `public.am_i_platform_admin` e `public.list_platform_clinics`.
// O client NÃO lê `private.platform_admins`, NÃO usa profiles.role, metadata nem membership.
import { supabase } from "@/lib/supabase";

export interface PlatformClinic {
  clinicId: string;
  clinicName: string;
  createdAt: string;
  ownerProfileId: string;
  professionalCount: number;
  patientCount: number;
}

interface PlatformClinicRow {
  clinic_id: string;
  clinic_name: string;
  created_at: string;
  owner_profile_id: string;
  professional_count: number | string | null;
  patient_count: number | string | null;
}

function toCount(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function mapClinic(row: PlatformClinicRow): PlatformClinic {
  return {
    clinicId: row.clinic_id,
    clinicName: row.clinic_name,
    createdAt: row.created_at,
    ownerProfileId: row.owner_profile_id,
    professionalCount: toCount(row.professional_count),
    patientCount: toCount(row.patient_count),
  };
}

/** Pergunta ao banco se a sessão atual é Platform Admin ativo. Erro ⇒ throw (nunca vira false). */
export async function amIPlatformAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc("am_i_platform_admin");
  if (error) throw error;
  return data === true;
}

/**
 * Catálogo global de clínicas (projection fail-closed no backend).
 * Sem join_code, e-mail, pacientes individuais ou dado clínico.
 */
export async function listPlatformClinics(): Promise<PlatformClinic[]> {
  const { data, error } = await supabase.rpc("list_platform_clinics");
  if (error) throw error;
  const rows = (data ?? []) as PlatformClinicRow[];
  return rows.map(mapClinic);
}
