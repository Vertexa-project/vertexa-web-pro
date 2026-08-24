import { AlertTriangle, Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useStaffNotifications } from "@/hooks/useStaffNotifications";
import { formatRelative } from "@/lib/domain/format";
import {
  STAFF_HELP_URGENCY,
  STAFF_NOTIFICATIONS_EMPTY,
  STAFF_NOTIFICATIONS_ERROR,
  isCriticalStaffNotification,
  isStaffNotificationUnread,
  staffNotificationBadgeLabel,
  staffNotificationHref,
  staffNotificationTitle,
} from "@/lib/domain/staffNotifications";
import { cn } from "@/lib/utils";
import type { StaffNotification } from "@/types/db";

export function StaffNotificationsBell() {
  const navigate = useNavigate();
  const { items, unreadCount, isLoading, isError, markRead } = useStaffNotifications();
  const badge = staffNotificationBadgeLabel(unreadCount);
  const ariaLabel =
    unreadCount > 0
      ? `Notificações, ${unreadCount > 99 ? "mais de 99" : unreadCount} não lidas`
      : "Notificações";

  function handleOpen(row: StaffNotification) {
    markRead(row.id);
    navigate(staffNotificationHref(row));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground"
          aria-label={ariaLabel}
          title={ariaLabel}
        >
          <Bell className="h-5 w-5" aria-hidden />
          {badge ? (
            <Badge
              tone="destructive"
              className="absolute -right-0.5 -top-0.5 h-4 min-w-4 justify-center px-1 text-[10px] leading-none tabular-nums"
              aria-hidden
            >
              {badge}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[min(24rem,70vh)] w-80 overflow-y-auto p-1"
        collisionPadding={12}
      >
        <DropdownMenuLabel>Notificações</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isLoading ? (
          <div className="space-y-2 px-2 py-3" role="status" aria-label="Carregando notificações">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">{STAFF_NOTIFICATIONS_ERROR}</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">{STAFF_NOTIFICATIONS_EMPTY}</p>
        ) : (
          items.map((row) => {
            const unread = isStaffNotificationUnread(row);
            const critical = isCriticalStaffNotification(row);
            return (
              <DropdownMenuItem
                key={row.id}
                className={cn(
                  "items-start gap-2 py-2",
                  critical && "border-l-2 border-l-warning bg-warning/5",
                  unread && "font-medium",
                )}
                onSelect={() => handleOpen(row)}
              >
                {critical ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                ) : (
                  <Bell className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate">{staffNotificationTitle(row)}</span>
                    {critical ? (
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-warning">
                        {STAFF_HELP_URGENCY}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    {formatRelative(row.created_at)}
                    {unread ? " · Não lida" : " · Lida"}
                  </span>
                </span>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
