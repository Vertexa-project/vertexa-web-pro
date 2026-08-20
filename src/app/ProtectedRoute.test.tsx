import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { ClinicMembership } from "@/lib/api/professionalStatus";
import type { ResolvedIdentity } from "@/lib/auth/identity";

/**
 * O DESVIO DO ProtectedRoute (WP-FRONT-2bii-A item 3) — cobertura de FIAÇÃO.
 *
 * A DECISÃO já é testada por função pura (`resolveClinicAccess`). O que só a montagem prova é o
 * `if` que a consome: que o painel NÃO monta quando a resposta é "desativado", que monta quando
 * é "ok", que ESPERA em vez de piscar a listagem vazia, e — o mais importante — que em ERRO ele
 * abre (fail-open deliberado: esta tela é explicação, não portão; o portão é a RLS).
 */

const state = vi.hoisted(() => ({
  authLoading: false,
  isAuthenticated: true,
  identity: { status: "active" } as unknown as ResolvedIdentity,
  memberships: undefined as ClinicMembership[] | undefined,
  membershipsLoading: false,
  membershipsError: false,
  askedWith: [] as boolean[],
}));

vi.mock("@/providers/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: state.isAuthenticated, loading: state.authLoading }),
}));
vi.mock("@/hooks/useIdentity", () => ({ useIdentity: () => state.identity }));
vi.mock("@/hooks/useProfessionalStatus", () => ({
  useMyClinicMemberships: (enabled: boolean) => {
    state.askedWith.push(enabled);
    return {
      data: state.memberships,
      isLoading: state.membershipsLoading,
      isError: state.membershipsError,
    };
  },
}));
// As telas viram marcadores: o que se testa AQUI é o desvio, não o texto delas (que tem arquivo
// próprio). Assim uma mudança de cópia não quebra o teste do roteamento.
vi.mock("@/pages/ClinicAccessRevokedPage", () => ({
  ClinicAccessRevokedPage: ({ clinics }: { clinics: ClinicMembership[] }) => (
    <div data-testid="tela-desativado">{clinics.map((c) => c.clinicName).join(",")}</div>
  ),
  NoClinicMembershipPage: () => <div data-testid="tela-sem-clinica" />,
}));
vi.mock("@/pages/PendingAccessPage", () => ({
  PendingAccessPage: () => <div data-testid="tela-pendente" />,
}));

const { ProtectedRoute } = await import("./ProtectedRoute");

function renderRoute() {
  return render(
    <MemoryRouter>
      <ProtectedRoute>
        <div data-testid="painel">Painel montado</div>
      </ProtectedRoute>
    </MemoryRouter>,
  );
}

function membership(status: string, name = "Clínica Vida Ativa"): ClinicMembership {
  return { clinicId: "c1", clinicName: name, status };
}

beforeEach(() => {
  state.authLoading = false;
  state.isAuthenticated = true;
  state.identity = { status: "active" } as unknown as ResolvedIdentity;
  state.memberships = [membership("active")];
  state.membershipsLoading = false;
  state.membershipsError = false;
  state.askedWith = [];
});

describe("ProtectedRoute — o desvio das duas telas novas", () => {
  it("com clínica ATIVA, o painel monta", () => {
    renderRoute();
    expect(screen.getByTestId("painel")).toBeInTheDocument();
    expect(screen.queryByTestId("tela-desativado")).not.toBeInTheDocument();
  });

  it("com TODAS as clínicas inativas, desvia para a tela de desativação — e o painel NÃO monta", () => {
    state.memberships = [membership("inactive")];
    renderRoute();

    expect(screen.getByTestId("tela-desativado")).toBeInTheDocument();
    expect(screen.queryByTestId("painel")).not.toBeInTheDocument();
  });

  it("passa as clínicas para a tela, que é de onde sai o nome", () => {
    state.memberships = [membership("inactive", "Clínica São Luís")];
    renderRoute();
    expect(screen.getByTestId("tela-desativado")).toHaveTextContent("Clínica São Luís");
  });

  it("sem clínica nenhuma, desvia para a tela PRÓPRIA (não para a de desativação)", () => {
    state.memberships = [];
    renderRoute();

    expect(screen.getByTestId("tela-sem-clinica")).toBeInTheDocument();
    expect(screen.queryByTestId("tela-desativado")).not.toBeInTheDocument();
    expect(screen.queryByTestId("painel")).not.toBeInTheDocument();
  });

  // Piscar a listagem "sem pacientes" para quem foi cortado é a mentira que o WP veio matar.
  it("enquanto a resposta não chega, ESPERA — não monta o painel", () => {
    state.membershipsLoading = true;
    state.memberships = undefined;
    renderRoute();

    expect(screen.queryByTestId("painel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tela-desativado")).not.toBeInTheDocument();
  });

  // FAIL-OPEN, e é deliberado: o portão é a RLS. Trancar por falha de rede deixaria gente ATIVA
  // do lado de fora — trocaria uma explicação por um incidente.
  it("se a RPC FALHA, o painel abre mesmo assim", () => {
    state.membershipsError = true;
    state.memberships = undefined;
    renderRoute();

    expect(screen.getByTestId("painel")).toBeInTheDocument();
    expect(screen.queryByTestId("tela-desativado")).not.toBeInTheDocument();
  });

  it("uma inativa e outra ATIVA: o painel abre (ela trabalha na outra clínica)", () => {
    state.memberships = [membership("inactive", "Alfa"), membership("active", "Beta")];
    renderRoute();
    expect(screen.getByTestId("painel")).toBeInTheDocument();
  });
});

describe("ProtectedRoute — a pergunta só é feita quando faz sentido", () => {
  it("identidade PENDENTE tem tela própria e não chega a perguntar clínicas", () => {
    state.identity = { status: "pending" } as unknown as ResolvedIdentity;
    renderRoute();

    expect(screen.getByTestId("tela-pendente")).toBeInTheDocument();
    expect(state.askedWith.every((enabled) => enabled === false)).toBe(true);
  });

  it("sem sessão, redireciona para o login antes de qualquer pergunta", () => {
    state.isAuthenticated = false;
    renderRoute();

    expect(screen.queryByTestId("painel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tela-desativado")).not.toBeInTheDocument();
  });

  it("com identidade ATIVA, a consulta é habilitada", () => {
    renderRoute();
    expect(state.askedWith.some((enabled) => enabled === true)).toBe(true);
  });
});
