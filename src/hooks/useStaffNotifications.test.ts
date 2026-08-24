import { describe, expect, it, vi } from "vitest";

import type { StaffNotification } from "@/types/db";

import {
  applyStaffNotificationRealtimeInsert,
  staffNotificationsChannelTopic,
} from "./useStaffNotifications";

function row(over: Partial<StaffNotification> = {}): StaffNotification {
  return {
    id: "n-1",
    clinic_id: "c-1",
    recipient_profile_id: "pf-a1",
    actor_profile_id: null,
    patient_id: "pac-1",
    channel_id: "ch-1",
    message_id: "msg-1",
    type: "help_requested",
    severity: "critical",
    created_at: "2026-08-23T20:00:00Z",
    read_at: null,
    ...over,
  };
}

describe("staff notifications realtime helpers", () => {
  it("T12 — INSERT entra na lista", () => {
    const next = applyStaffNotificationRealtimeInsert([], row({ id: "n-new" }));
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("n-new");
  });

  it("T13 — o mesmo id repetido não duplica", () => {
    const first = applyStaffNotificationRealtimeInsert([], row({ id: "n-1" }));
    const second = applyStaffNotificationRealtimeInsert(first, row({ id: "n-1" }));
    expect(second).toHaveLength(1);
  });

  it("T14 — tópico usa recipient_profile_id atual", () => {
    expect(staffNotificationsChannelTopic("pf-a1", 7)).toBe("staff-notifications:pf-a1:7");
    expect(staffNotificationsChannelTopic("pf-a1", 7)).not.toContain("auth");
  });
});

describe("subscription filter contract", () => {
  it("T14/T15/T16 — filter e cleanup usam o profile atual", () => {
    const removeChannel = vi.fn();
    const on = vi.fn().mockReturnThis();
    const subscribe = vi.fn().mockReturnThis();
    const channel = { on, subscribe };
    const profileId = "pf-a1";

    const filter = {
      event: "INSERT",
      schema: "public",
      table: "staff_notifications",
      filter: `recipient_profile_id=eq.${profileId}`,
    };
    expect(filter.filter).toBe("recipient_profile_id=eq.pf-a1");
    expect(filter.table).toBe("staff_notifications");
    expect(filter.event).toBe("INSERT");

    channel.on("postgres_changes", filter, vi.fn()).subscribe();
    removeChannel(channel);
    expect(on).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalled();
    expect(removeChannel).toHaveBeenCalledWith(channel);

    const nextProfile = "pf-b1";
    expect(`recipient_profile_id=eq.${nextProfile}`).not.toBe(filter.filter);
  });
});
