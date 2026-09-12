import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
        <Route path="/auth/signup" element={<div data-testid="signup" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.isAuthenticated = false;
  state.isPasswordRecovery = false;
  state.signIn.mockReset();
  state.signInWithGoogle.mockReset();
  state.signIn.mockResolvedValue(undefined);
  state.signInWithGoogle.mockResolvedValue(undefined);
});

describe("LoginPage — só autenticação real (WP-04A)", () => {
  it("mostra Continuar com Google e não oferece modo demonstração", () => {
    renderLogin();

    expect(screen.getByRole("button", { name: /continuar com google/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /entrar em modo demonstração/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/modo demonstração/i)).not.toBeInTheDocument();
  });

  it("já autenticado vai para /access (resolvedor único, sem decidir PA aqui)", () => {
    state.isAuthenticated = true;
    renderLogin();
    expect(screen.getByTestId("access")).toBeInTheDocument();
  });
});

describe("LoginPage — AUTH-03R + AUTH-EMAIL-02", () => {
  it("R1 — Esqueci minha senha abre o fluxo real de recuperação", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: /esqueci minha senha/i }));
    expect(screen.getByTestId("forgot-password")).toBeInTheDocument();
    expect(screen.queryByText(/disponível em breve/i)).not.toBeInTheDocument();
  });

  it("R16 — Google login existente continua", () => {
    renderLogin();
    expect(screen.getByRole("button", { name: /continuar com google/i })).toBeInTheDocument();
  });

  it("Criar conta abre /auth/signup", async () => {
    const user = userEvent.setup();
    renderLogin();
    expect(screen.getByText(/ainda não possui conta/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /criar conta/i }));
    expect(screen.getByTestId("signup")).toBeInTheDocument();
    expect(screen.queryByText(/cadastro disponível em breve/i)).not.toBeInTheDocument();
  });

  it("sessão PASSWORD_RECOVERY não cai em /access", () => {
    state.isAuthenticated = true;
    state.isPasswordRecovery = true;
    renderLogin();
    expect(screen.getByTestId("update-password")).toBeInTheDocument();
    expect(screen.queryByTestId("access")).not.toBeInTheDocument();
  });

  it("e-mail e senha corretos chamam signIn e vão a /access", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText(/^e-mail$/i), "ana@clinica.com");
    await user.type(screen.getByLabelText(/^senha$/i), "abcdefgh");
    await user.click(screen.getByRole("button", { name: /^entrar$/i }));
    await waitFor(() => expect(state.signIn).toHaveBeenCalledTimes(1));
    expect(state.signIn).toHaveBeenCalledWith("ana@clinica.com", "abcdefgh");
    expect(await screen.findByTestId("access")).toBeInTheDocument();
  });

  it("credencial inválida mostra erro seguro, sem enumerar conta", async () => {
    state.signIn.mockRejectedValue({ message: "Invalid login credentials", status: 400 });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText(/^e-mail$/i), "ana@clinica.com");
    await user.type(screen.getByLabelText(/^senha$/i), "erradaaaa");
    await user.click(screen.getByRole("button", { name: /^entrar$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/e-mail ou senha inválidos/i);
    expect(alert.textContent?.toLowerCase()).not.toContain("google");
    expect(alert.textContent?.toLowerCase()).not.toContain("não existe");
    expect(alert.textContent?.toLowerCase()).not.toContain("confirm");
  });

  it("rate limit no login é amigável e não tenta de novo sozinho", async () => {
    state.signIn.mockRejectedValue({ status: 429, message: "Request rate limit reached" });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText(/^e-mail$/i), "ana@clinica.com");
    await user.type(screen.getByLabelText(/^senha$/i), "abcdefgh");
    await user.click(screen.getByRole("button", { name: /^entrar$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/aguarde/i);
    expect(state.signIn).toHaveBeenCalledTimes(1);
  });
});
