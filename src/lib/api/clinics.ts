import { supabase } from "@/lib/supabase";
import {
  isClinicOnboardingMode,
  type ClinicOnboardingMode,
  type MyClinicCreationRequest,
} from "@/lib/domain/clinicOnboarding";
import type { Clinic } from "@/types/db";

/**
 * Clínica pelo id — usada no cabeçalho de relatórios (nome da clínica). A web só LÊ.
 * Isolamento real por clínica é dívida de RLS (#11–#14); aqui só resolvemos o nome.
 */
export async function getClinic(clinicId: string): Promise<Clinic | null> {
  const { data, error } = await supabase
    .from("clinics")
    .select("*")
    .eq("id", clinicId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Clinic | null;
}

export interface CreateClinicResult {
  clinicId: string;
  professionalId: string;
}

/**
 * Cria a PRÓPRIA clínica do usuário logado via RPC SECURITY DEFINER `create_clinic_with_owner`
 * (WP-ONBOARDING). O DONO é derivado do SERVIDOR (auth.uid()) — a web NÃO envia owner (não forjável).
 * A RPC é transacional (cria clínica + linha de professionals admin + destrava o perfil, tudo-ou-nada)
 * e recusa a segunda clínica do mesmo dono (guarda-corpo). Repassa o erro cru (a UI o traduz por `hint`).
 */
export async function createClinicWithOwner(name: string): Promise<CreateClinicResult> {
  const { data, error } = await supabase.rpc("create_clinic_with_owner", { p_name: name });
  if (error) throw error;
  const row = (data ?? {}) as { clinic_id?: string; professional_id?: string };
  return { clinicId: row.clinic_id ?? "", professionalId: row.professional_id ?? "" };
}

export interface ClinicOnboardingState {
  mode: ClinicOnboardingMode;
  request: MyClinicCreationRequest | null;
}

interface ClinicOnboardingStateRow {
  mode?: string;
  request?: {
    id?: string;
    requested_clinic_name?: string;
    status?: string;
    requested_at?: string;
    decided_at?: string | null;
    rejection_reason?: string | null;
  } | null;
}

function mapRequest(
  row: NonNullable<ClinicOnboardingStateRow["request"]>,
): MyClinicCreationRequest | null {
  if (
    typeof row.id !== "string" ||
    typeof row.requested_clinic_name !== "string" ||
    (row.status !== "pending" && row.status !== "approved" && row.status !== "rejected")
  ) {
    return null;
  }
  return {
    id: row.id,
    requestedClinicName: row.requested_clinic_name,
    status: row.status,
    requestedAt: row.requested_at ?? "",
    decidedAt: row.decided_at ?? null,
    rejectionReason: row.rejection_reason ?? null,
  };
}

/** Estado de onboarding do chamador. Sem patient_id / channel_id. */
export async function getClinicOnboardingState(): Promise<ClinicOnboardingState> {
  const { data, error } = await supabase.rpc("get_clinic_onboarding_state");
  if (error) throw error;
  const row = (data ?? {}) as ClinicOnboardingStateRow;
  const rawMode = row.mode ?? "";
  const mode = isClinicOnboardingMode(rawMode) ? rawMode : "closed";
  return {
    mode,
    request: row.request ? mapRequest(row.request) : null,
  };
}

export interface ClinicCreationRequestResult {
  requestId: string;
  status: "pending";
  requestedClinicName: string;
}

export async function requestClinicCreation(name: string): Promise<ClinicCreationRequestResult> {
  const { data, error } = await supabase.rpc("request_clinic_creation", { p_name: name });
  if (error) throw error;
  const row = (data ?? {}) as {
    request_id?: string;
    status?: string;
    requested_clinic_name?: string;
  };
  return {
    requestId: row.request_id ?? "",
    status: "pending",
    requestedClinicName: row.requested_clinic_name ?? name,
  };
}
