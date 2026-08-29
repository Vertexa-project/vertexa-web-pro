import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const state = vi.hoisted(() => ({
  isAuthenticated: false,
  signIn: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

vi.mock("@/providers/auth-context", () => ({
  useAuth: () => ({
    isAuthenticated: state.isAuthenticated,
    signIn: state.signIn,
    signInWithGoogle: state.signInWithGoogle,
  }),
}));

const { LoginPage } = await import("./LoginPage");

beforeEach(() => {
  state.isAuthenticated = false;
});

describe("LoginPage — só autenticação real (WP-04A)", () => {
  it("mostra Entrar com Google e não oferece modo demonstração", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /entrar com google/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /entrar em modo demonstração/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/modo demonstração/i)).not.toBeInTheDocument();
  });

  it("já autenticado vai para /access (resolvedor único, sem decidir PA aqui)", () => {
    state.isAuthenticated = true;
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/access" element={<div data-testid="access" />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("access")).toBeInTheDocument();
  });
});
