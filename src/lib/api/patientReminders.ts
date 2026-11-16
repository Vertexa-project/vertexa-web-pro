import { supabase } from "@/lib/supabase";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import { MAX_NOTICE_DAYS, type ReminderRow } from "@/lib/domain/patientReminders";

const COLS = "id, patient_id, kind, title, due_on, notify_patient, notify_days_before, pro_notify_days_before, message_template, done_at";

/** Lembretes do paciente (abertos primeiro, pela data). */
export async function listPatientReminders(patientId: string): Promise<ReminderRow[]> {
  const { data, error } = await supabase.from("patient_reminders").select(COLS).eq("patient_id", patientId).order("done_at", { ascending: false, nullsFirst: true }).order("due_on", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ReminderRow[];
}

interface RawClinicReminder extends ReminderRow {
  patient: { profile: { full_name: string | null } | null } | null;
}

/** Lembretes abertos da clínica que já podem estar na janela (até 90 dias à frente, qualquer atraso): UMA consulta, sem N+1. */
export async function listOpenReminders(limit = 300): Promise<Array<ReminderRow & { patientName: string }>> {
  const from = new Date(`${todayIsoBR()}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() + MAX_NOTICE_DAYS);
  const { data, error } = await supabase
    .from("patient_reminders")
    .select(`${COLS}, patient:patients ( profile:profiles ( full_name ) )`)
    .is("done_at", null)
    .lte("due_on", from.toISOString().slice(0, 10))
    .order("due_on", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as unknown as RawClinicReminder[]).map(({ patient, ...r }) => ({ ...r, patientName: patient?.profile?.full_name ?? "Paciente" }));
}

export interface UpsertReminderInput {
  patientId: string;
  id?: string | null;
  kind: "exam" | "return";
  title: string;
  dueOn: string;
  noticeDays: number;
  proNoticeDays: number;
  message: string;
  notifyPatient: boolean;
}

export async function upsertPatientReminder(i: UpsertReminderInput): Promise<string> {
  const { data, error } = await supabase.rpc("upsert_patient_reminder", {
    p_patient_id: i.patientId,
    p_kind: i.kind,
    p_title: i.kind === "exam" ? i.title : null,
    p_due_on: i.dueOn,
    p_notify_days: i.noticeDays,
    p_pro_notify_days: i.proNoticeDays,
    p_message: i.message.trim() ? i.message : null,
    p_notify_patient: i.notifyPatient,
    p_id: i.id ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function deletePatientReminder(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_patient_reminder", { p_id: id });
  if (error) throw error;
}

export async function completePatientReminder(id: string, done = true): Promise<void> {
  const { error } = await supabase.rpc("complete_patient_reminder", { p_id: id, p_done: done });
  if (error) throw error;
}
