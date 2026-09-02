import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { ClinicOnboardingState } from "@/lib/api/clinics";

const state = vi.hoisted(() => ({
  data: undefined as ClinicOnboardingState | undefined,
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: vi.fn(),
}));

const joinRequests = vi.hoisted(() => ({
  data: [] as Array<{ status: string }>,
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
vi.mock("@/hooks/useClinicJoin", () => ({
  useMyJoinRequests: () => joinRequests,
}));
vi.mock("@/components/onboarding/JoinClinicForm", () => ({
  JoinClinicForm: () => <div data-testid="join-clinic-form" />,
}));
vi.mock("@/components/onboarding/CreateClinicForm", () => ({
  CreateClinicForm: ({
    nameLocked,
    submitLabel,
  }: {
    nameLocked?: boolean;
    submitLabel?: string;
  }) => (
    <>
      {nameLocked ? <span>nome aprovado</span> : null}
      <button type="button">{submitLabel ?? "Criar minha clínica"}</button>
    </>
  ),
}));
vi.mock("@/components/onboarding/RequestClinicForm", () => ({
  RequestClinicForm: () => <button type="button">Enviar para análise</button>,
}));

const { PendingAccessPage } = await import("./PendingAccessPage");

beforeEach(() => {
  state.data = { mode: "closed", request: null };
  state.isLoading = false;
  state.isError = false;
  state.error = null;
  joinRequests.data = [];
});

function renderPage(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PendingAccessPage />
    </MemoryRouter>,
  );
}

describe("PendingAccessPage — escolhas e progressive disclosure", () => {
  it("U1 — estado inicial mostra apenas duas escolhas", () => {
    renderPage();
    expect(screen.getByTestId("onboarding-choices")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /vamos configurar seu acesso/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cadastrar minha clínica/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /entrar com código/i })).toBeInTheDocument();
    expect(screen.queryByTestId("join-clinic-form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /criar minha clínica/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enviar para análise/i })).not.toBeInTheDocument();
  });

  it("U2 — responsável abre o fluxo A", async () => {
    const user = userEvent.setup();
    state.data = { mode: "automatic", request: null };
    renderPage();
    await user.click(screen.getByRole("button", { name: /cadastrar minha clínica/i }));
    expect(screen.queryByTestId("onboarding-choices")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /cadastrar minha clínica/i })).toBeInTheDocument();
  });

  it("U3 — Voltar retorna às escolhas", async () => {
    const user = userEvent.setup();
    state.data = { mode: "automatic", request: null };
    renderPage();
    await user.click(screen.getByRole("button", { name: /cadastrar minha clínica/i }));
    await user.click(screen.getByRole("button", { name: /^voltar$/i }));
    expect(screen.getByTestId("onboarding-choices")).toBeInTheDocument();
  });

  it("U4 — convidado abre somente o formulário de código", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /entrar com código/i }));
    expect(screen.getByTestId("join-clinic-form")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-choices")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enviar para análise/i })).not.toBeInTheDocument();
  });

  it("U5 — automatic → copy e CTA corretos", async () => {
    const user = userEvent.setup();
    state.data = { mode: "automatic", request: null };
    renderPage();
    await user.click(screen.getByRole("button", { name: /cadastrar minha clínica/i }));
    expect(screen.getByText(/informe o nome da clínica para começar/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /criar minha clínica/i })).toBeInTheDocument();
  });

  it("U6 — manual_review → copy e CTA corretos", async () => {
    const user = userEvent.setup();
    state.data = { mode: "manual_review", request: null };
    renderPage();
    await user.click(screen.getByRole("button", { name: /cadastrar minha clínica/i }));
    expect(screen.getByRole("heading", { name: /solicitar cadastro da clínica/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enviar para análise/i })).toBeInTheDocument();
  });

  it("U7 — pending → estado correto (abre direto o fluxo A)", () => {
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
    expect(screen.getByRole("heading", { name: /solicitação enviada/i })).toBeInTheDocument();
    expect(screen.getByText(/alfa/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /criar minha clínica/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-choices")).not.toBeInTheDocument();
  });

  it("U8 — approved → nome readonly + CTA correto", () => {
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
    expect(screen.getByRole("heading", { name: /cadastro aprovado/i })).toBeInTheDocument();
    expect(screen.getByText(/nome aprovado/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /concluir cadastro/i })).toBeInTheDocument();
  });

  it("U9 — rejected → estado correto", () => {
    state.data = {
      mode: "manual_review",
      request: {
        id: "r1",
        requestedClinicName: "Alfa",
        status: "rejected",
        requestedAt: "2026-09-01T00:00:00Z",
        decidedAt: "2026-09-01T01:00:00Z",
        rejectionReason: "Nome em uso",
        grantIsActive: false,
      },
    };
    renderPage();
    expect(screen.getByRole("heading", { name: /cadastro não aprovado/i })).toBeInTheDocument();
    expect(screen.getByText(/nome em uso/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enviar para análise/i })).toBeInTheDocument();
  });

  it("U10 — closed → sem formulário de nome + possibilidade de voltar", async () => {
    const user = userEvent.setup();
    state.data = { mode: "closed", request: null };
    renderPage();
    await user.click(screen.getByRole("button", { name: /cadastrar minha clínica/i }));
    expect(screen.getByText(/não está recebendo novos cadastros/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /criar minha clínica/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enviar para análise/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^voltar$/i }));
    expect(screen.getByRole("button", { name: /entrar com código/i })).toBeInTheDocument();
  });

  it("U11 — join permanece funcional em qualquer policy", async () => {
    const user = userEvent.setup();
    state.data = { mode: "closed", request: null };
    renderPage();
    await user.click(screen.getByRole("button", { name: /entrar com código/i }));
    expect(screen.getByTestId("join-clinic-form")).toBeInTheDocument();
  });

  it("U12 — loading no fluxo A não parece empty", async () => {
    const user = userEvent.setup();
    state.isLoading = true;
    state.data = undefined;
    renderPage();
    expect(screen.getByTestId("onboarding-choices")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cadastrar minha clínica/i }));
    expect(screen.getByText(/clínica/i)).toBeInTheDocument();
    expect(screen.queryByText(/não está recebendo novos cadastros/i)).not.toBeInTheDocument();
  });

  it("U13 — erro não é apresentado como equipe vazia", async () => {
    const user = userEvent.setup();
    state.isError = true;
    state.error = { hint: "PROFILE_NOT_FOUND" };
    renderPage();
    await user.click(screen.getByRole("button", { name: /cadastrar minha clínica/i }));
    expect(screen.getByText(/não foi possível verificar a política/i)).toBeInTheDocument();
    expect(screen.getByText(/perfil Vertexa não foi encontrado/i)).toBeInTheDocument();
    expect(screen.queryByText(/não está recebendo novos cadastros/i)).not.toBeInTheDocument();
  });

  it("U14 — escolhas empilham no mobile e ficam lado a lado no desktop", () => {
    renderPage();
    expect(screen.getByTestId("onboarding-choices")).toHaveClass("md:grid-cols-2", "grid-cols-1");
  });

  it("U15 — escolhas são botões e o passo seguinte recebe foco", async () => {
    const user = userEvent.setup();
    state.data = { mode: "automatic", request: null };
    renderPage();
    expect(screen.getByRole("button", { name: /cadastrar minha clínica/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /entrar com código/i })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /cadastrar minha clínica/i }));
    expect(screen.getByRole("heading", { name: /cadastrar minha clínica/i })).toHaveFocus();
  });

  it("grant expirado volta a solicitar (S15)", () => {
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
    expect(screen.getByText(/prazo da aprovação anterior acabou/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enviar para análise/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /concluir cadastro/i })).not.toBeInTheDocument();
  });

  it("U3b — Voltar em pending não é revertido pelo auto-avanço", async () => {
    const user = userEvent.setup();
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
    expect(screen.getByRole("heading", { name: /solicitação enviada/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^voltar$/i }));
    expect(screen.getByTestId("onboarding-choices")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /entrar com código/i })).toBeInTheDocument();
  });

  it("não rouba o fluxo de join quando o status da clínica chega depois", async () => {
    const user = userEvent.setup();
    state.isLoading = true;
    state.data = undefined;
    const view = renderPage();
    await user.click(screen.getByRole("button", { name: /entrar com código/i }));
    expect(screen.getByTestId("join-clinic-form")).toBeInTheDocument();

    state.isLoading = false;
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
    view.rerender(
      <MemoryRouter>
        <PendingAccessPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("join-clinic-form")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /solicitação enviada/i })).not.toBeInTheDocument();
  });

  it("link ?code= abre o formulário de código, não as escolhas", () => {
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
    renderPage("/?code=ABCD2345");
    expect(screen.getByTestId("join-clinic-form")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-choices")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /solicitação enviada/i })).not.toBeInTheDocument();
  });

  it("pedido de join pendente reabre o fluxo B", () => {
    joinRequests.data = [{ status: "pending" }];
    renderPage();
    expect(screen.getByTestId("join-clinic-form")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-choices")).not.toBeInTheDocument();
  });
});
