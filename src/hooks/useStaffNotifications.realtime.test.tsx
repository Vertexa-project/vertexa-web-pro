import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const identity = vi.hoisted(() => ({ actingProfileId: "pf-a1" as string | null }));
const on = vi.hoisted(() => vi.fn());
const subscribe = vi.hoisted(() => vi.fn());
const removeChannel = vi.hoisted(() => vi.fn());
const channel = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useIdentity", () => ({
  useIdentity: () => identity,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from, channel, removeChannel },
}));

const { useStaffNotifications } = await import("./useStaffNotifications");

function chain(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.select = self;
  c.order = self;
  c.limit = self;
  c.is = self;
  c.eq = self;
  c.update = self;
  c.then = (fn: (value: unknown) => unknown) => Promise.resolve(result).then(fn);
  return c;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  identity.actingProfileId = "pf-a1";
  on.mockReset().mockReturnThis();
  subscribe.mockReset().mockReturnThis();
  removeChannel.mockReset();
  channel.mockReset().mockReturnValue({ on, subscribe });
  from.mockReset().mockImplementation(() => chain({ data: [], error: null, count: 0 }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useStaffNotifications realtime", () => {
  it("T14 — assina INSERT filtrado pelo recipient_profile_id atual", async () => {
    renderHook(() => useStaffNotifications(), { wrapper });
    await waitFor(() => expect(channel).toHaveBeenCalled());
    const topic = String(channel.mock.calls[0]?.[0]);
    expect(topic.startsWith("staff-notifications:pf-a1:")).toBe(true);
    expect(on).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "staff_notifications",
        filter: "recipient_profile_id=eq.pf-a1",
      },
      expect.any(Function),
    );
    expect(subscribe).toHaveBeenCalled();
  });

  it("T15 — cleanup remove o channel", async () => {
    const { unmount } = renderHook(() => useStaffNotifications(), { wrapper });
    await waitFor(() => expect(channel).toHaveBeenCalled());
    const created = channel.mock.results[0]?.value;
    unmount();
    expect(removeChannel).toHaveBeenCalledWith(created);
  });

  it("T16 — troca de perfil desfaz a subscription anterior", async () => {
    const { rerender } = renderHook(() => useStaffNotifications(), { wrapper });
    await waitFor(() => expect(channel).toHaveBeenCalledTimes(1));
    const first = channel.mock.results[0]?.value;
    identity.actingProfileId = "pf-b1";
    rerender();
    await waitFor(() => expect(channel).toHaveBeenCalledTimes(2));
    expect(removeChannel).toHaveBeenCalledWith(first);
    expect(String(channel.mock.calls[1]?.[0])).toContain("pf-b1");
    expect(on).toHaveBeenLastCalledWith(
      "postgres_changes",
      expect.objectContaining({ filter: "recipient_profile_id=eq.pf-b1" }),
      expect.any(Function),
    );
  });
});
