import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: { from },
}));

const {
  STAFF_NOTIFICATION_COLUMNS,
  getUnreadStaffNotificationsCount,
  listRecentStaffNotifications,
  markStaffNotificationRead,
} = await import("./staffNotifications");

type Builder = {
  select: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  then: (onfulfilled: (value: unknown) => unknown) => Promise<unknown>;
};

function makeBuilder(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const builder = {} as Builder;
  builder.select = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.then = (onfulfilled) => Promise.resolve(result).then(onfulfilled);
  return builder;
}

let lastTable = "";
let builder: Builder;

beforeEach(() => {
  lastTable = "";
  builder = makeBuilder({ data: [], error: null, count: 0 });
  from.mockImplementation((table: string) => {
    lastTable = table;
    return builder;
  });
});

describe("staffNotifications API", () => {
  it("T1 — lista recentes ORDER BY created_at DESC LIMIT 10", async () => {
    const rows = [
      { id: "n-2", created_at: "2026-08-23T21:00:00Z" },
      { id: "n-1", created_at: "2026-08-23T20:00:00Z" },
    ];
    builder = makeBuilder({ data: rows, error: null });
    from.mockImplementation((table: string) => {
      lastTable = table;
      return builder;
    });

    await expect(listRecentStaffNotifications(10)).resolves.toEqual(rows);
    expect(lastTable).toBe("staff_notifications");
    expect(builder.select).toHaveBeenCalledWith(STAFF_NOTIFICATION_COLUMNS);
    expect(STAFF_NOTIFICATION_COLUMNS).not.toMatch(/body/);
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(10);
  });

  it("T2 — unread count só read_at IS NULL", async () => {
    builder = makeBuilder({ data: null, error: null, count: 3 });
    from.mockImplementation((table: string) => {
      lastTable = table;
      return builder;
    });

    await expect(getUnreadStaffNotificationsCount()).resolves.toBe(3);
    expect(builder.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(builder.is).toHaveBeenCalledWith("read_at", null);
  });

  it("T3 — mark own read envia somente read_at", async () => {
    builder = makeBuilder({ data: null, error: null });
    from.mockImplementation((table: string) => {
      lastTable = table;
      return builder;
    });

    await markStaffNotificationRead("n-1");
    expect(builder.update).toHaveBeenCalledTimes(1);
    const payload = builder.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["read_at"]);
    expect(typeof payload.read_at).toBe("string");
    expect(builder.eq).toHaveBeenCalledWith("id", "n-1");
  });

  it("T18/T19 — não usa public.notifications nem chat_mentions", async () => {
    await listRecentStaffNotifications();
    await getUnreadStaffNotificationsCount();
    await markStaffNotificationRead("n-1");
    const tables = from.mock.calls.map((c) => c[0]);
    expect(tables.every((t) => t === "staff_notifications")).toBe(true);
    expect(tables).not.toContain("notifications");
    expect(tables).not.toContain("chat_mentions");
  });
});
