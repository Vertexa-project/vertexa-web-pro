import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const state = vi.hoisted(() => ({
  isAuthenticated: false,
  isPasswordRecovery: false,
  signIn: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

vi.mock("@/providers/auth-context", () => ({
  useAuth: () => ({
    isAuthenticated: state.isAuthenticated,
    isPasswordRecovery: state.isPasswordRecovery,
    signIn: state.signIn,
    signInWithGoogle: state.signInWithGoogle,
  }),
}));

const { LoginPage } = await import("./LoginPage");

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/access" element={<div data-testid="access" />} />
        <Route path="/auth/forgot-password" element={<div data-testid="forgot-password" />} />
        <Route path="/auth/update-password" element={<div data-testid="update-password" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.isAuthenticated = false;
  state.isPasswordRecovery = false;
});

describe("LoginPage — só autenticação real (WP-04A)", () => {
  it("mostra Entrar com Google e não oferece modo demonstração", () => {
    renderLogin();

    expect(screen.getByRole("button", { name: /entrar com google/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /entrar em modo demonstração/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/modo demonstração/i)).not.toBeInTheDocument();
  });

  it("já autenticado vai para /access (resolvedor único, sem decidir PA aqui)", () => {
    state.isAuthenticated = true;
    renderLogin();
    expect(screen.getByTestId("access")).toBeInTheDocument();
  });
});

describe("LoginPage — AUTH-03R", () => {
  it("R1 — Esqueceu a senha? abre o fluxo real de recuperação", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: /esqueceu a senha\?/i }));
    expect(screen.getByTestId("forgot-password")).toBeInTheDocument();
    expect(screen.queryByText(/disponível em breve/i)).not.toBeInTheDocument();
  });

  it("R16 — Google login existente continua", () => {
    renderLogin();
    expect(screen.getByRole("button", { name: /entrar com google/i })).toBeInTheDocument();
  });

  it("R17 — Cadastre-se continua sem signup real", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: /cadastre-se/i }));
    expect(screen.getByText(/cadastro disponível em breve/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /criar conta/i })).not.toBeInTheDocument();
  });

  it("sessão PASSWORD_RECOVERY não cai em /access", () => {
    state.isAuthenticated = true;
    state.isPasswordRecovery = true;
    renderLogin();
    expect(screen.getByTestId("update-password")).toBeInTheDocument();
    expect(screen.queryByTestId("access")).not.toBeInTheDocument();
  });
});
