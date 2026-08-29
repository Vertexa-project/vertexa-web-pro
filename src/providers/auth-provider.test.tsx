import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";

import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

const listeners = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: listeners.getSession,
      onAuthStateChange: listeners.onAuthStateChange,
      signOut: listeners.signOut,
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
  },
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureException: vi.fn(),
}));

vi.mock("./query-client", () => ({
  queryClient: { clear: vi.fn() },
}));

const { AuthProvider } = await import("./auth-provider");
const { useAuth } = await import("./auth-context");

function Probe({ onReady }: { onReady: (value: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  useEffect(() => {
    onReady(auth);
  }, [auth, onReady]);
  return (
    <div>
      <span data-testid="recovery">{String(auth.isPasswordRecovery)}</span>
      <span data-testid="authed">{String(auth.isAuthenticated)}</span>
    </div>
  );
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      removeItem: vi.fn(),
      getItem: vi.fn(),
      setItem: vi.fn(),
    },
  });
});

describe("AuthProvider — PASSWORD_RECOVERY", () => {
  it("PASSWORD_RECOVERY liga a flag; SIGNED_OUT desliga", async () => {
    listeners.getSession.mockResolvedValue({ data: { session: null } });
    let emit: ((event: AuthChangeEvent, session: Session | null) => void) | undefined;
    listeners.onAuthStateChange.mockImplementation((cb: typeof emit) => {
      emit = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    render(
      <AuthProvider>
        <Probe onReady={() => undefined} />
      </AuthProvider>,
    );

    await waitFor(() => expect(emit).toBeTypeOf("function"));

    await act(async () => {
      emit?.("PASSWORD_RECOVERY", { user: { id: "u1" } } as Session);
    });
    expect(await screen.findByTestId("recovery")).toHaveTextContent("true");
    expect(screen.getByTestId("authed")).toHaveTextContent("true");

    await act(async () => {
      emit?.("SIGNED_OUT", null);
    });
    expect(await screen.findByTestId("recovery")).toHaveTextContent("false");
    expect(screen.getByTestId("authed")).toHaveTextContent("false");
  });

  it("SIGNED_IN comum não liga recovery", async () => {
    listeners.getSession.mockResolvedValue({ data: { session: null } });
    let emit: ((event: AuthChangeEvent, session: Session | null) => void) | undefined;
    listeners.onAuthStateChange.mockImplementation((cb: typeof emit) => {
      emit = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    render(
      <AuthProvider>
        <Probe onReady={() => undefined} />
      </AuthProvider>,
    );

    await waitFor(() => expect(emit).toBeTypeOf("function"));
    await act(async () => {
      emit?.("SIGNED_IN", { user: { id: "u1" } } as Session);
    });
    expect(await screen.findByTestId("recovery")).toHaveTextContent("false");
    expect(screen.getByTestId("authed")).toHaveTextContent("true");
  });
});
