// Superfície pública de Platform Admin (WP-10B2B).
// A autoridade REAL é o banco: `public.am_i_platform_admin` e `public.list_platform_clinics`.
// O client NÃO lê `private.platform_admins`, NÃO usa profiles.role, metadata nem membership.
import { supabase } from "@/lib/supabase";
import {
  isClinicOnboardingMode,
  type ClinicCreationRequestStatus,
  type ClinicOnboardingMode,
} from "@/lib/domain/clinicOnboarding";

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

export interface PlatformOnboardingSettings {
  mode: ClinicOnboardingMode;
  updatedAt: string | null;
  updatedByProfileId: string | null;
  updatedByName: string | null;
  pendingRequestCount: number;
}

interface PlatformOnboardingSettingsRow {
  mode?: string;
  updated_at?: string | null;
  updated_by_profile_id?: string | null;
  updated_by_name?: string | null;
  pending_request_count?: number | string | null;
}

function mapSettings(row: PlatformOnboardingSettingsRow): PlatformOnboardingSettings {
  const rawMode = row.mode ?? "";
  return {
    mode: isClinicOnboardingMode(rawMode) ? rawMode : "closed",
    updatedAt: row.updated_at ?? null,
    updatedByProfileId: row.updated_by_profile_id ?? null,
    updatedByName: row.updated_by_name ?? null,
    pendingRequestCount: toCount(row.pending_request_count),
  };
}

export async function getPlatformClinicOnboardingSettings(): Promise<PlatformOnboardingSettings> {
  const { data, error } = await supabase.rpc("get_platform_clinic_onboarding_settings");
  if (error) throw error;
  return mapSettings((data ?? {}) as PlatformOnboardingSettingsRow);
}

export async function setClinicOnboardingPolicy(
  mode: ClinicOnboardingMode,
): Promise<PlatformOnboardingSettings> {
  const { data, error } = await supabase.rpc("set_clinic_onboarding_policy", { p_mode: mode });
  if (error) throw error;
  return mapSettings((data ?? {}) as PlatformOnboardingSettingsRow);
}

export interface PlatformClinicRequest {
  requestId: string;
  requestedClinicName: string;
  requesterProfileId: string;
  requesterName: string | null;
  requesterEmail: string | null;
  status: ClinicCreationRequestStatus;
  requestedAt: string;
  decidedAt: string | null;
  rejectionReason: string | null;
}

interface PlatformClinicRequestRow {
  request_id: string;
  requested_clinic_name: string;
  requester_profile_id: string;
  requester_name: string | null;
  requester_email: string | null;
  status: string;
  requested_at: string;
  decided_at: string | null;
  rejection_reason: string | null;
}

function mapRequest(row: PlatformClinicRequestRow): PlatformClinicRequest | null {
  if (row.status !== "pending" && row.status !== "approved" && row.status !== "rejected") {
    return null;
  }
  return {
    requestId: row.request_id,
    requestedClinicName: row.requested_clinic_name,
    requesterProfileId: row.requester_profile_id,
    requesterName: row.requester_name,
    requesterEmail: row.requester_email,
    status: row.status,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    rejectionReason: row.rejection_reason,
  };
}

export async function listClinicCreationRequests(): Promise<PlatformClinicRequest[]> {
  const { data, error } = await supabase.rpc("list_clinic_creation_requests");
  if (error) throw error;
  const rows = (data ?? []) as PlatformClinicRequestRow[];
  return rows.map(mapRequest).filter((row): row is PlatformClinicRequest => row !== null);
}

export async function approveClinicCreationRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc("approve_clinic_creation_request", {
    p_request_id: requestId,
  });
  if (error) throw error;
}

export async function rejectClinicCreationRequest(
  requestId: string,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc("reject_clinic_creation_request", {
    p_request_id: requestId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}
