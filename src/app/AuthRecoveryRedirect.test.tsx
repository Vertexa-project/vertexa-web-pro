import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { PASSWORD_RESET_INVALID_MESSAGE } from "@/lib/auth/passwordRecovery";

const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  loading: false,
  isPasswordRecovery: false,
}));

vi.mock("@/providers/auth-context", () => ({
  useAuth: () => ({
    isAuthenticated: auth.isAuthenticated,
    loading: auth.loading,
    isPasswordRecovery: auth.isPasswordRecovery,
  }),
}));

const { AuthRecoveryRedirect } = await import("./AuthRecoveryRedirect");
const { AuthGate } = await import("./AuthGate");
const { UpdatePasswordPage } = await import("@/pages/UpdatePasswordPage");

function ClinicalOnboarding() {
  return (
    <div>
      <h1>Falta um passo para começar</h1>
      <button type="button">Criar minha clínica</button>
      <div data-testid="create-clinic-form" />
      <p>Entrar em uma clínica</p>
    </div>
  );
}

function renderTree(entry: { pathname: string; hash?: string; search?: string }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route element={<AuthRecoveryRedirect />}>
          <Route path="/login" element={<div data-testid="login" />} />
          <Route
            path="/"
            element={
              <AuthGate>
                <ClinicalOnboarding />
              </AuthGate>
            }
          />
          <Route
            path="/platform"
            element={
              <AuthGate>
                <div data-testid="platform-shell">Dashboard da plataforma</div>
              </AuthGate>
            }
          />
          <Route path="/auth/update-password" element={<UpdatePasswordPage />} />
          <Route path="/auth/callback" element={<div data-testid="oauth-callback" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.isAuthenticated = false;
  auth.loading = false;
  auth.isPasswordRecovery = false;
});

describe("AuthRecoveryRedirect — AUTH-03R routing", () => {
  it("R6 — /auth/update-password existe fora dos shells", () => {
    auth.isAuthenticated = false;
    auth.isPasswordRecovery = true;
    renderTree({ pathname: "/auth/update-password" });
    expect(screen.getByLabelText(/^nova senha$/i)).toBeInTheDocument();
    expect(screen.queryByTestId("platform-shell")).not.toBeInTheDocument();
    expect(screen.queryByText(/falta um passo para começar/i)).not.toBeInTheDocument();
  });

  it("R7/R8/R9 — hash otp_expired em / NÃO monta PendingAccess/CreateClinic", () => {
    auth.isAuthenticated = true;
    auth.isPasswordRecovery = false;
    renderTree({
      pathname: "/",
      hash: "#error=access_denied&error_code=otp_expired&error_description=Email%20link%20is%20invalid%20or%20has%20expired",
    });
    expect(screen.getByText(PASSWORD_RESET_INVALID_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/falta um passo para começar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/criar minha clínica/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-clinic-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("platform-shell")).not.toBeInTheDocument();
  });

  it("PASSWORD_RECOVERY em /access-equivalente (AuthGate) vai para update-password", () => {
    auth.isAuthenticated = true;
    auth.isPasswordRecovery = true;
    renderTree({ pathname: "/" });
    expect(screen.getByLabelText(/^nova senha$/i)).toBeInTheDocument();
    expect(screen.queryByText(/falta um passo para começar/i)).not.toBeInTheDocument();
  });

  it("OAuth callback com error não é sequestrado", () => {
    auth.isAuthenticated = false;
    auth.isPasswordRecovery = false;
    renderTree({ pathname: "/auth/callback", search: "?error=access_denied" });
    expect(screen.getByTestId("oauth-callback")).toBeInTheDocument();
    expect(screen.queryByText(PASSWORD_RESET_INVALID_MESSAGE)).not.toBeInTheDocument();
  });
});
