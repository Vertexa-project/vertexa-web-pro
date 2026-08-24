import type { StaffNotification } from "@/types/db";

export const STAFF_HELP_TITLE = "Pedido de ajuda";
export const STAFF_HELP_URGENCY = "Urgente";
export const STAFF_NOTIFICATIONS_EMPTY = "Nenhuma notificação no momento.";
export const STAFF_NOTIFICATIONS_ERROR = "Não foi possível carregar as notificações.";
export const STAFF_ACCESS_REVOKED_TITLE = "Este atendimento não está mais disponível.";
export const STAFF_ACCESS_REVOKED_DESCRIPTION =
  "Você não tem mais acesso a esta conversa.";

export function isStaffNotificationUnread(row: StaffNotification): boolean {
  return row.read_at == null;
}

/** Badge do sino: ausente se 0; 1–99; `99+` acima. */
export function staffNotificationBadgeLabel(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? "99+" : String(unread);
}

export function staffNotificationTitle(row: StaffNotification): string {
  return row.type === "help_requested" ? STAFF_HELP_TITLE : "Notificação";
}

export function isCriticalStaffNotification(row: StaffNotification): boolean {
  return row.type === "help_requested" || row.severity === "critical";
}

/** Deep link mínimo sobre a rota real `/mensagens`. */
export function staffNotificationHref(row: StaffNotification): string {
  if (row.patient_id) return `/mensagens?patient=${encodeURIComponent(row.patient_id)}`;
  return "/mensagens";
}

/**
 * Incorpora um INSERT de realtime na lista recente sem duplicar o mesmo id
 * (reconnect / StrictMode / refetch já incorporou).
 */
export function mergeStaffNotificationInsert(
  current: StaffNotification[],
  incoming: StaffNotification,
  limit = 10,
): StaffNotification[] {
  if (current.some((row) => row.id === incoming.id)) return current;
  return [incoming, ...current]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, limit);
}

export function nextUnreadCountAfterInsert(
  currentCount: number,
  incoming: StaffNotification,
  alreadyPresent: boolean,
): number {
  if (alreadyPresent || !isStaffNotificationUnread(incoming)) return currentCount;
  return currentCount + 1;
}
