import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { PASSWORD_RESET_NOTICE } from "@/lib/auth/passwordRecovery";

const auth = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
}));

vi.mock("@/providers/auth-context", () => ({
  useAuth: () => ({
    requestPasswordReset: auth.requestPasswordReset,
  }),
}));

const { ForgotPasswordPage } = await import("./ForgotPasswordPage");

function renderForgot() {
  return render(
    <MemoryRouter initialEntries={["/auth/forgot-password"]}>
      <Routes>
        <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/login" element={<div data-testid="login" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.requestPasswordReset.mockReset();
  auth.requestPasswordReset.mockResolvedValue(undefined);
});

describe("ForgotPasswordPage", () => {
  it("R2 — e-mail vazio não envia", async () => {
    const user = userEvent.setup();
    renderForgot();
    await user.click(screen.getByRole("button", { name: /enviar link de recuperação/i }));
    expect(auth.requestPasswordReset).not.toHaveBeenCalled();
  });

  it("R2 — e-mail inválido não envia", async () => {
    const user = userEvent.setup();
    renderForgot();
    await user.type(screen.getByLabelText(/e-mail/i), "nao-e-email");
    await user.click(screen.getByRole("button", { name: /enviar link de recuperação/i }));
    expect(auth.requestPasswordReset).not.toHaveBeenCalled();
  });

  it("R3 — e-mail válido chama requestPasswordReset", async () => {
    const user = userEvent.setup();
    renderForgot();
    await user.type(screen.getByLabelText(/e-mail/i), "pessoa@clinica.com");
    await user.click(screen.getByRole("button", { name: /enviar link de recuperação/i }));
    expect(auth.requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(auth.requestPasswordReset).toHaveBeenCalledWith("pessoa@clinica.com");
  });

  it("R5 — resposta visual é genérica (anti-enumeration)", async () => {
    const user = userEvent.setup();
    renderForgot();
    await user.type(screen.getByLabelText(/e-mail/i), "pessoa@clinica.com");
    await user.click(screen.getByRole("button", { name: /enviar link de recuperação/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(PASSWORD_RESET_NOTICE);
    expect(screen.queryByText(/não encontramos/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/enviamos para/i)).not.toBeInTheDocument();
  });
});
