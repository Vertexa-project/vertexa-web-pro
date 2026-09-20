import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const auth = vi.hoisted(() => ({
  signOut: vi.fn(async () => {}),
}));

vi.mock("@/providers/auth-context", () => ({
  useAuth: () => ({ signOut: auth.signOut }),
}));

vi.mock("@/hooks/useAmIPlatformAdmin", () => ({
  useAmIPlatformAdmin: () => ({
    isPlatformAdmin: true,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePlatformOnboarding", () => ({
  usePlatformOnboardingSettings: () => ({
    data: { pendingRequestCount: 0, mode: "closed" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const { PlatformShell } = await import("./PlatformShell");

describe("PlatformShell", () => {
  it("T15 — logout encerra a sessão e vai para /login", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/platform"]}>
        <Routes>
          <Route path="/platform" element={<PlatformShell />} />
          <Route path="/login" element={<div data-testid="login" />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Plataforma")).toBeInTheDocument();
    expect(screen.getByText("VERTEXA")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /sair/i }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId("login")).toBeInTheDocument();
    });
  });

  it("navega a área da plataforma sem chrome clínico", () => {
    render(
      <MemoryRouter initialEntries={["/platform"]}>
        <PlatformShell />
      </MemoryRouter>,
    );
    expect(screen.getByRole("navigation", { name: "Área da plataforma" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Solicitações" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clínicas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Faturamento" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configurações" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/whatsapp/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pacientes/i)).not.toBeInTheDocument();
  });
});
