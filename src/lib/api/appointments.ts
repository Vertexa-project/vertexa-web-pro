import { supabase } from "@/lib/supabase";
import type { Appointment, AppointmentStatus, AppointmentType, AppointmentView } from "@/types/db";

// Linha de appointments com paciente/profissional embutidos (joins PostgREST) p/ resolver nomes.
interface RawAppointmentRow extends Appointment {
  patient: { profile: { full_name: string | null } | null } | null;
  professional: { profile: { full_name: string | null } | null } | null;
}

const SELECT_WITH_NAMES =
  "*, patient:patients ( profile:profiles ( full_name ) ), professional:professionals ( profile:profiles!professionals_profile_id_fkey ( full_name ) )";

function toView(row: RawAppointmentRow): AppointmentView {
  const { patient, professional, ...appt } = row;
  return {
    ...appt,
    patient_name: patient?.profile?.full_name ?? null,
    professional_name: professional?.profile?.full_name ?? null,
  };
}

/**
 * Compromissos de uma clínica numa janela [from, to) (ISO), ordenados por início.
 * Escopado por `clinic_id` (isolamento por clínica do profissional logado). A web só
 * usa esta tabela (agenda interna); o app paciente não a consome.
 */
export async function listAppointments(
  clinicId: string,
  fromISO: string,
  toISO: string,
): Promise<AppointmentView[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select(SELECT_WITH_NAMES)
    .eq("clinic_id", clinicId)
    .gte("starts_at", fromISO)
    .lt("starts_at", toISO)
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as RawAppointmentRow[]).map(toView);
}

export interface AppointmentInput {
  clinicId: string;
  title: string;
  startsAt: string; // ISO
  endsAt: string | null; // ISO | null
  patientId: string | null;
  professionalId: string | null;
  notes: string | null;
  type: AppointmentType;
  status: AppointmentStatus;
}

function toRow(input: AppointmentInput) {
  return {
    clinic_id: input.clinicId,
    title: input.title.trim(),
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    patient_id: input.patientId,
    professional_id: input.professionalId,
    notes: input.notes?.trim() || null,
    type: input.type,
    status: input.status,
  };
}

export async function createAppointment(input: AppointmentInput): Promise<Appointment> {
  if (!input.clinicId) throw new Error("Sem clínica para vincular o compromisso.");
  if (!input.title.trim()) throw new Error("Dê um título ao compromisso.");
  const { data, error } = await supabase.from("appointments").insert(toRow(input)).select("*").single();
  if (error) throw error;
  return data as Appointment;
}

export async function updateAppointment(id: string, input: AppointmentInput): Promise<Appointment> {
  if (!input.title.trim()) throw new Error("Dê um título ao compromisso.");
  const { data, error } = await supabase
    .from("appointments")
    .update(toRow(input))
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Appointment;
}

export async function deleteAppointment(id: string): Promise<void> {
  const { error } = await supabase.from("appointments").delete().eq("id", id);
  if (error) throw error;
}
