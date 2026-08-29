import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { PASSWORD_RESET_INVALID_MESSAGE, PASSWORD_UPDATED_MESSAGE } from "@/lib/auth/passwordRecovery";

const auth = vi.hoisted(() => ({
  loading: false,
  isPasswordRecovery: false,
  updatePassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/providers/auth-context", () => ({
  useAuth: () => ({
    loading: auth.loading,
    isPasswordRecovery: auth.isPasswordRecovery,
    updatePassword: auth.updatePassword,
    signOut: auth.signOut,
  }),
}));

const { UpdatePasswordPage } = await import("./UpdatePasswordPage");

const SECRET = "Nx7qK2mL";

function renderUpdate(entry: string | { pathname: string; hash?: string; search?: string } = "/auth/update-password") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/auth/update-password" element={<UpdatePasswordPage />} />
        <Route path="/auth/forgot-password" element={<div data-testid="forgot-password" />} />
        <Route path="/login" element={<div data-testid="login" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.loading = false;
  auth.isPasswordRecovery = false;
  auth.updatePassword.mockReset();
  auth.signOut.mockReset();
  auth.updatePassword.mockResolvedValue(undefined);
  auth.signOut.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UpdatePasswordPage — recovery inválido", () => {
  it("R7 — link expirado mostra estado seguro", () => {
    renderUpdate({
      pathname: "/auth/update-password",
      hash: "#error=access_denied&error_code=otp_expired",
    });
    expect(screen.getByText(PASSWORD_RESET_INVALID_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^nova senha$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/otp_expired/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/email link is invalid/i)).not.toBeInTheDocument();
  });

  it("R8/R9 — recovery inválido não mostra onboarding clínico", () => {
    renderUpdate({
      pathname: "/auth/update-password",
      hash: "#error=access_denied&error_code=otp_expired",
    });
    expect(screen.queryByText(/falta um passo para começar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/criar minha clínica/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/entrar em uma clínica/i)).not.toBeInTheDocument();
  });

  it("oferece solicitar novo link", async () => {
    const user = userEvent.setup();
    renderUpdate({
      pathname: "/auth/update-password",
      hash: "#error=access_denied&error_code=otp_expired",
    });
    await user.click(screen.getByRole("button", { name: /solicitar novo link/i }));
    expect(screen.getByTestId("forgot-password")).toBeInTheDocument();
  });
});

describe("UpdatePasswordPage — recovery válido", () => {
  beforeEach(() => {
    auth.isPasswordRecovery = true;
  });

  it("R10 — mostra nova senha e confirmação", () => {
    renderUpdate();
    expect(screen.getByLabelText(/^nova senha$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirmar nova senha/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /redefinir senha/i })).toBeInTheDocument();
  });

  it("R11 — senhas divergentes não chamam updateUser", async () => {
    const user = userEvent.setup();
    renderUpdate();
    await user.type(screen.getByLabelText(/^nova senha$/i), SECRET);
    await user.type(screen.getByLabelText(/confirmar nova senha/i), `${SECRET}x`);
    await user.click(screen.getByRole("button", { name: /redefinir senha/i }));
    expect(auth.updatePassword).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("R12/R14/R15 — senha válida chama updateUser uma vez, signOut e vai ao login", async () => {
    let releaseSignOut: (() => void) | undefined;
    auth.signOut.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSignOut = resolve;
        }),
    );

    const user = userEvent.setup();
    renderUpdate();
    await user.type(screen.getByLabelText(/^nova senha$/i), SECRET);
    await user.type(screen.getByLabelText(/confirmar nova senha/i), SECRET);
    await user.click(screen.getByRole("button", { name: /redefinir senha/i }));

    await waitFor(() => expect(auth.updatePassword).toHaveBeenCalledTimes(1));
    expect(auth.updatePassword).toHaveBeenCalledWith(SECRET);
    expect(await screen.findByText(PASSWORD_UPDATED_MESSAGE)).toBeInTheDocument();
    expect(auth.signOut).toHaveBeenCalledTimes(1);

    releaseSignOut?.();
    expect(await screen.findByTestId("login")).toBeInTheDocument();
  });

  it("R13 — senha não aparece em logs", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "debug")];
    spies.forEach((spy) => spy.mockImplementation(() => undefined));

    const user = userEvent.setup();
    renderUpdate();
    await user.type(screen.getByLabelText(/^nova senha$/i), SECRET);
    await user.type(screen.getByLabelText(/confirmar nova senha/i), SECRET);
    await user.click(screen.getByRole("button", { name: /redefinir senha/i }));
    await waitFor(() => expect(auth.updatePassword).toHaveBeenCalledTimes(1));

    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    }
  });
});
