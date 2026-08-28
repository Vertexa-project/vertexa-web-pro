import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { footerNav, mainNav } from "./routes";

const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  loading: false,
}));

vi.mock("@/providers/auth-context", () => ({
  useAuth: () => ({ isAuthenticated: auth.isAuthenticated, loading: auth.loading }),
}));

const platform = vi.hoisted(() => ({
  isPlatformAdmin: false as boolean | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useAmIPlatformAdmin", () => ({
  useAmIPlatformAdmin: () => ({
    isPlatformAdmin: platform.isPlatformAdmin,
    isLoading: platform.isLoading,
    isError: platform.isError,
    refetch: platform.refetch,
  }),
}));

const { AuthGate } = await import("./AuthGate");
const { AccessResolver } = await import("./AccessResolver");
const { PlatformAdminGate } = await import("./PlatformAdminGate");

function renderPlatformTree(initial = "/platform") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/login" element={<div data-testid="login" />} />
        <Route path="/" element={<div data-testid="clinico" />} />
        <Route path="/access" element={<AccessResolver />} />
        <Route
          path="/platform"
          element={
            <AuthGate>
              <PlatformAdminGate>
                <div data-testid="plataforma">Dashboard da plataforma</div>
              </PlatformAdminGate>
            </AuthGate>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.isAuthenticated = false;
  auth.loading = false;
  platform.isPlatformAdmin = false;
  platform.isLoading = false;
  platform.isError = false;
});

describe("AuthGate + PlatformAdminGate — /platform", () => {
  it("T1 — não autenticado em /platform vai para o login", () => {
    auth.isAuthenticated = false;
    renderPlatformTree("/platform");
    expect(screen.getByTestId("login")).toBeInTheDocument();
    expect(screen.queryByTestId("plataforma")).not.toBeInTheDocument();
  });

  it("T2 — autenticado + PA false não renderiza o conteúdo de /platform", () => {
    auth.isAuthenticated = true;
    platform.isPlatformAdmin = false;
    renderPlatformTree("/platform");
    expect(screen.queryByTestId("plataforma")).not.toBeInTheDocument();
    expect(screen.getByTestId("clinico")).toBeInTheDocument();
  });

  it("T3 — clinic admin (PA false) também é bloqueado em /platform", () => {
    auth.isAuthenticated = true;
    platform.isPlatformAdmin = false;
    renderPlatformTree("/platform");
    expect(screen.queryByTestId("plataforma")).not.toBeInTheDocument();
  });

  it("T4 — PA true permite /platform", () => {
    auth.isAuthenticated = true;
    platform.isPlatformAdmin = true;
    renderPlatformTree("/platform");
    expect(screen.getByTestId("plataforma")).toBeInTheDocument();
  });

  it("T6 — erro em am_i_platform_admin no gate FAIL CLOSED (não monta filhos)", () => {
    auth.isAuthenticated = true;
    platform.isError = true;
    platform.isPlatformAdmin = undefined;
    renderPlatformTree("/platform");
    expect(screen.getByTestId("platform-authority-error")).toBeInTheDocument();
    expect(screen.queryByTestId("plataforma")).not.toBeInTheDocument();
    expect(screen.queryByTestId("clinico")).not.toBeInTheDocument();
  });

  it("T8 — reload direto em /platform com sessão PA funciona", () => {
    auth.isAuthenticated = true;
    platform.isPlatformAdmin = true;
    renderPlatformTree("/platform");
    expect(screen.getByTestId("plataforma")).toBeInTheDocument();
    expect(screen.queryByTestId("login")).not.toBeInTheDocument();
  });
});

describe("AccessResolver", () => {
  it("T16 — PA true → /platform", () => {
    auth.isAuthenticated = true;
    platform.isPlatformAdmin = true;
    renderPlatformTree("/access");
    expect(screen.getByTestId("plataforma")).toBeInTheDocument();
  });

  it("T17 — PA false → /", () => {
    auth.isAuthenticated = true;
    platform.isPlatformAdmin = false;
    renderPlatformTree("/access");
    expect(screen.getByTestId("clinico")).toBeInTheDocument();
    expect(screen.queryByTestId("plataforma")).not.toBeInTheDocument();
  });

  it("T18 — RPC error → fail closed (não navega)", () => {
    auth.isAuthenticated = true;
    platform.isError = true;
    platform.isPlatformAdmin = undefined;
    renderPlatformTree("/access");
    expect(screen.getByTestId("platform-authority-error")).toBeInTheDocument();
    expect(screen.queryByTestId("plataforma")).not.toBeInTheDocument();
    expect(screen.queryByTestId("clinico")).not.toBeInTheDocument();
  });
});

describe("T9 — menu clínico não anuncia a área plataforma", () => {
  it("sidebar clínica não contém /platform", () => {
    const paths = [...mainNav, ...footerNav].map((item) => item.path);
    expect(paths.some((path) => path.startsWith("/platform"))).toBe(false);
  });
});
