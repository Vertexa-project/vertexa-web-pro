import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { SIGNUP_CHECK_EMAIL_BODY, SIGNUP_CHECK_EMAIL_TITLE } from "@/lib/auth/signup";

const signUpWithEmail = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/authSignup", () => ({
  signUpWithEmail,
}));

const { SignupPage } = await import("./SignupPage");

function renderSignup() {
  return render(
    <MemoryRouter initialEntries={["/auth/signup"]}>
      <Routes>
        <Route path="/auth/signup" element={<SignupPage />} />
        <Route path="/login" element={<div data-testid="login" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  signUpWithEmail.mockReset();
  signUpWithEmail.mockResolvedValue({ kind: "check_email" });
});

async function fillValidSignup(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/nome completo/i), "Ana Costa");
  await user.type(screen.getByLabelText(/^e-mail$/i), "ana@clinica.com");
  await user.type(screen.getByLabelText(/^senha$/i), "abcdefgh");
  await user.type(screen.getByLabelText(/confirmar senha/i), "abcdefgh");
}

describe("SignupPage — AUTH-EMAIL-02", () => {
  it("mostra nome, e-mail, senha, confirmação e requisito de 8 caracteres", () => {
    renderSignup();
    expect(screen.getByLabelText(/nome completo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^e-mail$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^senha$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirmar senha/i)).toBeInTheDocument();
    expect(screen.getByText(/mínimo de 8 caracteres/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /criar conta/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/sou responsável/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/role=admin/i)).not.toBeInTheDocument();
  });

  it("senha curta não chama a API e foca o campo", async () => {
    const user = userEvent.setup({ delay: null });
    renderSignup();
    await user.type(screen.getByLabelText(/nome completo/i), "Ana Costa");
    await user.type(screen.getByLabelText(/^e-mail$/i), "ana@clinica.com");
    await user.type(screen.getByLabelText(/^senha$/i), "abcdefg");
    await user.type(screen.getByLabelText(/confirmar senha/i), "abcdefg");
    await user.click(screen.getByRole("button", { name: /criar conta/i }));
    expect(signUpWithEmail).not.toHaveBeenCalled();
    expect(screen.getByText(/pelo menos 8 caracteres/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^senha$/i)).toHaveFocus();
  });

  it("senhas divergentes não chamam a API", async () => {
    const user = userEvent.setup({ delay: null });
    renderSignup();
    await user.type(screen.getByLabelText(/nome completo/i), "Ana Costa");
    await user.type(screen.getByLabelText(/^e-mail$/i), "ana@clinica.com");
    await user.type(screen.getByLabelText(/^senha$/i), "abcdefgh");
    await user.type(screen.getByLabelText(/confirmar senha/i), "abcdefghx");
    await user.click(screen.getByRole("button", { name: /criar conta/i }));
    expect(signUpWithEmail).not.toHaveBeenCalled();
    expect(screen.getByText(/não coincidem/i)).toBeInTheDocument();
  });

  it("sucesso mostra Confira seu e-mail sem enumerar conta", async () => {
    const user = userEvent.setup({ delay: null });
    renderSignup();
    await fillValidSignup(user);
    await user.click(screen.getByRole("button", { name: /criar conta/i }));

    await waitFor(() => expect(signUpWithEmail).toHaveBeenCalledTimes(1));
    expect(signUpWithEmail).toHaveBeenCalledWith({
      email: "ana@clinica.com",
      password: "abcdefgh",
      fullName: "Ana Costa",
    });
    expect(await screen.findByRole("heading", { name: SIGNUP_CHECK_EMAIL_TITLE })).toBeInTheDocument();
    expect(screen.getByText(SIGNUP_CHECK_EMAIL_BODY)).toBeInTheDocument();
    expect(screen.queryByText(/já cadastrado/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/paciente/i)).not.toBeInTheDocument();
  });

  it("duplicata da API também mostra o estado neutro", async () => {
    signUpWithEmail.mockResolvedValue({ kind: "check_email" });
    const user = userEvent.setup({ delay: null });
    renderSignup();
    await fillValidSignup(user);
    await user.click(screen.getByRole("button", { name: /criar conta/i }));
    expect(await screen.findByRole("heading", { name: SIGNUP_CHECK_EMAIL_TITLE })).toBeInTheDocument();
  });

  it("rate limit mostra aviso e não reenvia sozinho", async () => {
    signUpWithEmail.mockResolvedValue({ kind: "rate_limited" });
    const user = userEvent.setup({ delay: null });
    renderSignup();
    await fillValidSignup(user);
    await user.click(screen.getByRole("button", { name: /criar conta/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/aguarde/i);
    expect(signUpWithEmail).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: SIGNUP_CHECK_EMAIL_TITLE })).not.toBeInTheDocument();
  });

  it("senha não aparece em logs", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "debug")];
    spies.forEach((spy) => spy.mockImplementation(() => undefined));
    const user = userEvent.setup({ delay: null });
    renderSignup();
    await user.type(screen.getByLabelText(/nome completo/i), "Ana Costa");
    await user.type(screen.getByLabelText(/^e-mail$/i), "ana@clinica.com");
    await user.type(screen.getByLabelText(/^senha$/i), "Nx7qK2mL");
    await user.type(screen.getByLabelText(/confirmar senha/i), "Nx7qK2mL");
    await user.click(screen.getByRole("button", { name: /criar conta/i }));
    await waitFor(() => expect(signUpWithEmail).toHaveBeenCalledTimes(1));
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("Nx7qK2mL");
    }
  });
});
