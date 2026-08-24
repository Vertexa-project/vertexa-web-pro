import { supabase } from "@/lib/supabase";
import type { StaffNotification } from "@/types/db";

/** Colunas da inbox — sem body, diagnóstico ou embeds clínicos. */
export const STAFF_NOTIFICATION_COLUMNS =
  "id, clinic_id, recipient_profile_id, actor_profile_id, patient_id, channel_id, message_id, type, severity, created_at, read_at";

export async function listRecentStaffNotifications(
  limit = 10,
): Promise<StaffNotification[]> {
  const { data, error } = await supabase
    .from("staff_notifications")
    .select(STAFF_NOTIFICATION_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as StaffNotification[];
}

export async function getUnreadStaffNotificationsCount(): Promise<number> {
  const { count, error } = await supabase
    .from("staff_notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

/** PATCH só `read_at`. Qualquer outro campo seria rejeitado pelo GRANT. */
export async function markStaffNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from("staff_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
