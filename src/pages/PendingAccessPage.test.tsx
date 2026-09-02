import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { ClinicOnboardingState } from "@/lib/api/clinics";

const state = vi.hoisted(() => ({
  data: undefined as ClinicOnboardingState | undefined,
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: vi.fn(),
}));

vi.mock("@/providers/auth-context", () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}));
vi.mock("@/hooks/useIdentity", () => ({
  useIdentity: () => ({ email: "user@t.test" }),
}));
vi.mock("@/hooks/useClinicOnboardingState", () => ({
  useClinicOnboardingState: () => state,
}));
vi.mock("@/components/onboarding/JoinClinicForm", () => ({
  JoinClinicForm: () => <div data-testid="join-clinic-form" />,
}));
vi.mock("@/components/onboarding/CreateClinicForm", () => ({
  CreateClinicForm: () => <button type="button">Criar minha clínica</button>,
}));
vi.mock("@/components/onboarding/RequestClinicForm", () => ({
  RequestClinicForm: () => <button type="button">Solicitar criação da clínica</button>,
}));

const { PendingAccessPage } = await import("./PendingAccessPage");

beforeEach(() => {
  state.data = undefined;
  state.isLoading = false;
  state.isError = false;
  state.error = null;
});

function renderPage() {
  return render(
    <MemoryRouter>
      <PendingAccessPage />
    </MemoryRouter>,
  );
}

describe("PendingAccessPage — política sem flash de vazio", () => {
  it("loading não mostra empty de 'sem profissional'", () => {
    state.isLoading = true;
    renderPage();
    expect(screen.queryByText(/temporariamente indisponíveis/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /criar minha clínica/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("join-clinic-form")).toBeInTheDocument();
  });

  it("erro não é apresentado como equipe vazia", () => {
    state.isError = true;
    renderPage();
    expect(screen.getByText(/não foi possível verificar a política/i)).toBeInTheDocument();
    expect(screen.queryByText(/temporariamente indisponíveis/i)).not.toBeInTheDocument();
  });

  it("PROFILE_NOT_FOUND explica sessão sem perfil", () => {
    state.isError = true;
    state.error = { hint: "PROFILE_NOT_FOUND" };
    renderPage();
    expect(screen.getByText(/perfil Vertexa não foi encontrado/i)).toBeInTheDocument();
  });

  it("closed mostra bloqueio e mantém join", () => {
    state.data = { mode: "closed", request: null };
    renderPage();
    expect(screen.getByText(/temporariamente indisponíveis/i)).toBeInTheDocument();
    expect(screen.getByTestId("join-clinic-form")).toBeInTheDocument();
  });

  it("automatic mostra criar", () => {
    state.data = { mode: "automatic", request: null };
    renderPage();
    expect(screen.getByRole("button", { name: /criar minha clínica/i })).toBeInTheDocument();
  });

  it("manual sem pedido mostra solicitar", () => {
    state.data = { mode: "manual_review", request: null };
    renderPage();
    expect(screen.getByRole("button", { name: /solicitar criação da clínica/i })).toBeInTheDocument();
  });

  it("manual approved trava o nome analisado", () => {
    state.data = {
      mode: "manual_review",
      request: {
        id: "r1",
        requestedClinicName: "Alfa",
        status: "approved",
        requestedAt: "2026-09-01T00:00:00Z",
        decidedAt: "2026-09-01T01:00:00Z",
        rejectionReason: null,
        grantIsActive: true,
      },
    };
    renderPage();
    expect(screen.getByText(/nome analisado/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /criar minha clínica/i })).toBeInTheDocument();
  });

  it("manual approved com grant expirado volta a solicitar (S15)", () => {
    state.data = {
      mode: "manual_review",
      request: {
        id: "r1",
        requestedClinicName: "Alfa",
        status: "approved",
        requestedAt: "2026-09-01T00:00:00Z",
        decidedAt: "2026-09-01T01:00:00Z",
        rejectionReason: null,
        grantIsActive: false,
      },
    };
    renderPage();
    expect(screen.getByText(/autorização anterior expirou/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /solicitar criação da clínica/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /criar minha clínica/i })).not.toBeInTheDocument();
  });

  it("manual pending não oferece criar", () => {
    state.data = {
      mode: "manual_review",
      request: {
        id: "r1",
        requestedClinicName: "Alfa",
        status: "pending",
        requestedAt: "2026-09-01T00:00:00Z",
        decidedAt: null,
        rejectionReason: null,
        grantIsActive: null,
      },
    };
    renderPage();
    expect(screen.getByText(/aguardando análise/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /criar minha clínica/i })).not.toBeInTheDocument();
  });
});
