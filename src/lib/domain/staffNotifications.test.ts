import { describe, expect, it } from "vitest";

import type { StaffNotification } from "@/types/db";

import {
  STAFF_HELP_TITLE,
  isCriticalStaffNotification,
  isStaffNotificationUnread,
  mergeStaffNotificationInsert,
  nextUnreadCountAfterInsert,
  staffNotificationBadgeLabel,
  staffNotificationHref,
  staffNotificationTitle,
} from "./staffNotifications";

function row(over: Partial<StaffNotification> = {}): StaffNotification {
  return {
    id: "n-1",
    clinic_id: "c-1",
    recipient_profile_id: "pf-1",
    actor_profile_id: "pf-pat",
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

describe("staffNotificationBadgeLabel", () => {
  it("T4 — unread 0 → sem badge", () => {
    expect(staffNotificationBadgeLabel(0)).toBeNull();
  });

  it("T5 — unread 1 → 1", () => {
    expect(staffNotificationBadgeLabel(1)).toBe("1");
  });

  it("T6 — unread > 99 → 99+", () => {
    expect(staffNotificationBadgeLabel(100)).toBe("99+");
    expect(staffNotificationBadgeLabel(99)).toBe("99");
  });
});

describe("staff notification copy", () => {
  it("T7 — help_requested é crítico e se chama Pedido de ajuda", () => {
    const n = row();
    expect(isCriticalStaffNotification(n)).toBe(true);
    expect(staffNotificationTitle(n)).toBe(STAFF_HELP_TITLE);
  });

  it("T8 — título não inclui corpo clínico", () => {
    const title = staffNotificationTitle(row());
    expect(title).not.toMatch(/Preciso de ajuda/i);
    expect(title).not.toMatch(/diagn/i);
    expect(JSON.stringify(row())).not.toContain("body");
  });

  it("T10 — href usa a rota real /mensagens?patient=", () => {
    expect(staffNotificationHref(row())).toBe("/mensagens?patient=pac-1");
    expect(staffNotificationHref(row({ patient_id: null }))).toBe("/mensagens");
  });

  it("T11 — lida não conta como unread", () => {
    expect(isStaffNotificationUnread(row({ read_at: "2026-08-23T21:00:00Z" }))).toBe(false);
    expect(isStaffNotificationUnread(row({ read_at: null }))).toBe(true);
  });
});

describe("mergeStaffNotificationInsert", () => {
  it("T12/T13 — INSERT novo entra; o mesmo id não duplica", () => {
    const a = row({ id: "n-1", created_at: "2026-08-23T20:00:00Z" });
    const b = row({ id: "n-2", created_at: "2026-08-23T20:01:00Z" });
    const once = mergeStaffNotificationInsert([a], b);
    expect(once.map((n) => n.id)).toEqual(["n-2", "n-1"]);
    const twice = mergeStaffNotificationInsert(once, b);
    expect(twice.map((n) => n.id)).toEqual(["n-2", "n-1"]);
    expect(nextUnreadCountAfterInsert(1, b, true)).toBe(1);
    expect(nextUnreadCountAfterInsert(1, b, false)).toBe(2);
    expect(nextUnreadCountAfterInsert(1, row({ id: "n-3", read_at: "x" }), false)).toBe(1);
  });
});
