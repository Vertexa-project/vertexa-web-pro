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

  it("não monta Sidebar clínica, Topbar, SOS nem mentions", () => {
    const { container } = render(
      <MemoryRouter>
        <PlatformShell />
      </MemoryRouter>,
    );
    expect(container.querySelector("nav")).toBeNull();
    expect(screen.queryByLabelText(/whatsapp/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pacientes/i)).not.toBeInTheDocument();
  });
});
