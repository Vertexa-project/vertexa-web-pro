import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const navigate = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const onAuthStateChange = vi.hoisted(() =>
  vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
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
});
