import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { ClinicMembership } from "@/lib/api/professionalStatus";
import type { ResolvedIdentity } from "@/lib/auth/identity";

/**
 * O DESVIO DO ProtectedRoute (WP-FRONT-2bii-A item 3 + WP-10B2B intercept de Platform Admin).
 *
 * A DECISÃO clínica já é testada por função pura (`resolveClinicAccess`). O que só a montagem prova é o
 * `if` que a consome: que o painel NÃO monta quando a resposta é "desativado", que monta quando
 * é "ok", que ESPERA em vez de piscar a listagem vazia, e — o mais importante — que em ERRO ele
 * abre (fail-open deliberado: esta tela é explicação, não portão; o portão é a RLS).
 *
 * WP-10B2B: identidade pending NÃO pode montar onboarding clínico se a RPC de Platform Admin
 * for true ou estiver em erro.
 */

const state = vi.hoisted(() => ({
  authLoading: false,
  isAuthenticated: true,
  identity: { status: "active" } as unknown as ResolvedIdentity,
  memberships: undefined as ClinicMembership[] | undefined,
  membershipsLoading: false,
  membershipsError: false,
  askedWith: [] as boolean[],
  platformAdminEnabled: [] as boolean[],
  platformAdminLoading: false,
  platformAdminError: false,
  isPlatformAdmin: false as boolean | undefined,
  commercial: {
    data: {
      clinicId: "c1",
      accessClass: "FULL",
      reason: "ACTIVE_CONTRACT",
      productAllowed: true,
      rolloutMode: "OBSERVE",
    } as {
      clinicId: string;
      accessClass: string;
      reason: string;
      productAllowed: boolean;
      rolloutMode: string;
    } | undefined,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: () => undefined,
  },
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
vi.mock("@/hooks/useAmIPlatformAdmin", () => ({
  useAmIPlatformAdmin: (enabled = true) => {
    state.platformAdminEnabled.push(enabled);
    return {
      isPlatformAdmin: state.isPlatformAdmin,
      isLoading: state.platformAdminLoading,
      isError: state.platformAdminError,
      refetch: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/useCommercialAccess", () => ({
  useMyClinicCommercialAccess: () => state.commercial,
}));
// As telas viram marcadores: o que se testa AQUI é o desvio, não o texto delas (que tem arquivo
// próprio). Assim uma mudança de cópia não quebra o teste do roteamento.
vi.mock("@/pages/ClinicAccessRevokedPage", () => ({
  ClinicAccessRevokedPage: ({ clinics }: { clinics: ClinicMembership[] }) => (
    <div data-testid="tela-desativado">{clinics.map((c) => c.clinicName).join(",")}</div>
  ),
  NoClinicMembershipPage: () => <div data-testid="tela-sem-clinica" />,
}));
vi.mock("@/pages/ClinicSuspendedPage", () => ({
  ClinicSuspendedPage: ({ clinics }: { clinics: ClinicMembership[] }) => (
    <div data-testid="tela-suspensa">{clinics.map((c) => c.clinicName).join(",")}</div>
  ),
}));
vi.mock("@/pages/PendingAccessPage", () => ({
  PendingAccessPage: () => (
    <div data-testid="tela-pendente">
      <div data-testid="create-clinic-form" />
    </div>
  ),
}));
vi.mock("@/pages/CommercialActivationPage", () => ({
  CommercialActivationPage: () => <div data-testid="tela-pre-contrato" />,
}));

const { ProtectedRoute } = await import("./ProtectedRoute");

function renderRoute(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <div data-testid="painel">Painel montado</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div data-testid="login" />} />
        <Route path="/platform" element={<div data-testid="plataforma" />} />
        <Route
          path="/configuracoes/faturamento"
          element={
            <ProtectedRoute>
              <div data-testid="faturamento">Faturamento</div>
            </ProtectedRoute>
          }
        />
      </Routes>
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
  state.platformAdminEnabled = [];
  state.platformAdminLoading = false;
  state.platformAdminError = false;
  state.isPlatformAdmin = false;
  state.commercial = {
    data: {
      clinicId: "c1",
      accessClass: "FULL",
      reason: "ACTIVE_CONTRACT",
      productAllowed: true,
      rolloutMode: "OBSERVE",
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => undefined,
  };
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

  it("S29/S36 — só clínica suspensa mostra UX própria, não PendingAccess nem criar clínica", () => {
    state.memberships = [
      {
        clinicId: "susp",
        clinicName: "Clínica Pausada",
        status: "active",
        clinicStatus: "suspended",
      },
    ];
    renderRoute();
    expect(screen.getByTestId("tela-suspensa")).toBeInTheDocument();
    expect(screen.queryByTestId("painel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tela-pendente")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tela-sem-clinica")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-clinic-form")).not.toBeInTheDocument();
  });

  it("S35 — ACTIVE + SUSPENDED monta o painel da ACTIVE", () => {
    state.memberships = [
      {
        clinicId: "susp",
        clinicName: "Pausada",
        status: "active",
        clinicStatus: "suspended",
      },
      { clinicId: "ok", clinicName: "Aberta", status: "active", clinicStatus: "active" },
    ];
    renderRoute();
    expect(screen.getByTestId("painel")).toBeInTheDocument();
    expect(screen.queryByTestId("tela-suspensa")).not.toBeInTheDocument();
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

    expect(screen.getByTestId("login")).toBeInTheDocument();
    expect(screen.queryByTestId("painel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tela-desativado")).not.toBeInTheDocument();
  });

  it("com identidade ATIVA, a consulta é habilitada", () => {
    renderRoute();
    expect(state.askedWith.some((enabled) => enabled === true)).toBe(true);
  });
});

describe("ProtectedRoute — intercept Platform Admin (WP-10B2B)", () => {
  it("T5 — PA true + identity pending NÃO monta PendingAccess/CreateClinicForm e vai a /platform", () => {
    state.identity = { status: "pending" } as unknown as ResolvedIdentity;
    state.isPlatformAdmin = true;
    renderRoute();

    expect(screen.getByTestId("plataforma")).toBeInTheDocument();
    expect(screen.queryByTestId("tela-pendente")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-clinic-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("painel")).not.toBeInTheDocument();
  });

  it("T7 — erro em am_i_platform_admin no pending NÃO mostra onboarding (fail closed)", () => {
    state.identity = { status: "pending" } as unknown as ResolvedIdentity;
    state.platformAdminError = true;
    state.isPlatformAdmin = undefined;
    renderRoute();

    expect(screen.getByTestId("platform-authority-error")).toBeInTheDocument();
    expect(screen.queryByTestId("tela-pendente")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-clinic-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("painel")).not.toBeInTheDocument();
  });

  it("T9 — usuário clínico ativo + PA false continua no painel clínico", () => {
    state.isPlatformAdmin = false;
    renderRoute();
    expect(screen.getByTestId("painel")).toBeInTheDocument();
    expect(screen.queryByTestId("plataforma")).not.toBeInTheDocument();
  });

  it("T10 — pending + PA false preserva PendingAccessPage", () => {
    state.identity = { status: "pending" } as unknown as ResolvedIdentity;
    state.isPlatformAdmin = false;
    renderRoute();

    expect(screen.getByTestId("tela-pendente")).toBeInTheDocument();
    expect(screen.getByTestId("create-clinic-form")).toBeInTheDocument();
    expect(screen.queryByTestId("plataforma")).not.toBeInTheDocument();
  });

  it("identidade ativa não habilita a RPC de Platform Admin no gate clínico", () => {
    renderRoute();
    expect(state.platformAdminEnabled.some((enabled) => enabled === true)).toBe(false);
  });

  it("identidade pending habilita a RPC de Platform Admin antes do onboarding", () => {
    state.identity = { status: "pending" } as unknown as ResolvedIdentity;
    renderRoute();
    expect(state.platformAdminEnabled.some((enabled) => enabled === true)).toBe(true);
  });
});

describe("ProtectedRoute — PRE_CONTRACT commercial gate", () => {
  it("ENFORCE without contract replaces the clinical panel", () => {
    state.commercial = {
      data: {
        clinicId: "c1",
        accessClass: "PRE_CONTRACT",
        reason: "NO_ACTIVE_CONTRACT",
        productAllowed: false,
        rolloutMode: "ENFORCE",
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: () => undefined,
    };
    renderRoute();
    expect(screen.getByTestId("tela-pre-contrato")).toBeInTheDocument();
    expect(screen.queryByTestId("painel")).not.toBeInTheDocument();
  });

  it("still allows Faturamento / Planos while PRE_CONTRACT", () => {
    state.commercial = {
      data: {
        clinicId: "c1",
        accessClass: "PRE_CONTRACT",
        reason: "NO_ACTIVE_CONTRACT",
        productAllowed: false,
        rolloutMode: "ENFORCE",
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: () => undefined,
    };
    renderRoute("/configuracoes/faturamento");
    expect(screen.getByTestId("faturamento")).toBeInTheDocument();
    expect(screen.queryByTestId("tela-pre-contrato")).not.toBeInTheDocument();
  });

  it("OBSERVE without contract keeps current product access", () => {
    state.commercial = {
      data: {
        clinicId: "c1",
        accessClass: "PRE_CONTRACT",
        reason: "OBSERVE_ONLY",
        productAllowed: true,
        rolloutMode: "OBSERVE",
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: () => undefined,
    };
    renderRoute();
    expect(screen.getByTestId("painel")).toBeInTheDocument();
    expect(screen.queryByTestId("tela-pre-contrato")).not.toBeInTheDocument();
  });

  it("recognized missing RPC remains compatible and mounts the product", () => {
    state.commercial = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { code: "PGRST202", message: "Could not find the function get_my_clinic_commercial_access" },
      refetch: () => undefined,
    };
    renderRoute();
    expect(screen.getByTestId("painel")).toBeInTheDocument();
    expect(screen.queryByTestId("commercial-access-error")).not.toBeInTheDocument();
  });

  it("ENFORCE resolver network failure does not mount the clinical product", () => {
    state.commercial = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { message: "Failed to fetch" },
      refetch: () => undefined,
    };
    renderRoute();
    expect(screen.getByTestId("commercial-access-error")).toBeInTheDocument();
    expect(screen.queryByTestId("painel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tela-pre-contrato")).not.toBeInTheDocument();
  });

  it("ENFORCE HTTP 500 does not grant FULL access", () => {
    state.commercial = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { code: "500", message: "internal" },
      refetch: () => undefined,
    };
    renderRoute();
    expect(screen.getByTestId("commercial-access-error")).toBeInTheDocument();
    expect(screen.queryByTestId("painel")).not.toBeInTheDocument();
  });

  it("ENFORCE malformed payload does not mount the clinical product", () => {
    state.commercial = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: {
        code: "COMMERCIAL_ACCESS_MALFORMED",
        hint: "COMMERCIAL_ACCESS_MALFORMED",
        message: "COMMERCIAL_ACCESS_MALFORMED",
      },
      refetch: () => undefined,
    };
    renderRoute();
    expect(screen.getByTestId("commercial-access-error")).toBeInTheDocument();
    expect(screen.queryByTestId("painel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tela-pre-contrato")).not.toBeInTheDocument();
  });

  it("expired session is auth, not PRE_CONTRACT", () => {
    state.commercial = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { hint: "BILLING_NOT_AUTHENTICATED", code: "42501" },
      refetch: () => undefined,
    };
    renderRoute();
    expect(screen.getByTestId("login")).toBeInTheDocument();
    expect(screen.queryByTestId("painel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tela-pre-contrato")).not.toBeInTheDocument();
  });
});
