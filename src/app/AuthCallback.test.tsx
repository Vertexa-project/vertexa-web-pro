import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const navigate = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const onAuthStateChange = vi.hoisted(() =>
  vi.fn((_cb?: (event: string, session: { user: { id: string } } | null) => void) => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  })),
);

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession,
      onAuthStateChange,
    },
  },
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureException: vi.fn(),
}));

const { AuthCallback } = await import("./AuthCallback");

beforeEach(() => {
  navigate.mockReset();
  getSession.mockReset();
  onAuthStateChange.mockReset();
  onAuthStateChange.mockImplementation(() => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  }));
});

describe("AuthCallback — destino único /access", () => {
  it("sessão confirmada navega para /access, não para /", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
    render(
      <MemoryRouter initialEntries={["/auth/callback"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/access", { replace: true });
    });
    expect(navigate).not.toHaveBeenCalledWith("/", expect.anything());
  });

  it("PASSWORD_RECOVERY no callback não vai para /access nem /platform", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    let emit: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
    onAuthStateChange.mockImplementation((cb: typeof emit) => {
      emit = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    render(
      <MemoryRouter initialEntries={["/auth/callback"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(emit).toBeTypeOf("function"));
    emit?.("PASSWORD_RECOVERY", { user: { id: "u1" } });

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/auth/update-password", { replace: true });
    });
    expect(navigate).not.toHaveBeenCalledWith("/access", expect.anything());
    expect(navigate).not.toHaveBeenCalledWith("/platform", expect.anything());
  });
});
