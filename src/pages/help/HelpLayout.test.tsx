import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const state = vi.hoisted(() => ({
  auth: { isAuthenticated: true, loading: false, isPasswordRecovery: false, signOut: vi.fn() },
  access: { data: { allowed: true, reason: "ok", platformAdmin: false }, isLoading: false, isError: false, refetch: vi.fn() } as {
    data?: { allowed: boolean; reason: string; platformAdmin: boolean };
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
  },
}));

vi.mock("@/providers/auth-context", () => ({ useAuth: () => state.auth }));
vi.mock("@/hooks/useHelpCenter", () => ({ useHelpCenterAccess: () => state.access }));
vi.mock("@/hooks/useSupport", () => ({ useMySupportUnread: () => ({ data: 3 }) }));

const { HelpLayout } = await import("./HelpLayout");
const { peekHelpReturn } = await import("@/lib/help/returnTo");

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/ajuda" element={<HelpLayout />}>
          <Route index element={<div data-testid="home" />} />
          <Route path="suporte" element={<div data-testid="suporte" />} />
        </Route>
        <Route path="/login" element={<div data-testid="login" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("HelpLayout — quem entra na Central de Ajuda", () => {
  beforeEach(() => {
    sessionStorage.clear();
    state.auth.isAuthenticated = true;
    state.access.data = { allowed: true, reason: "ok", platformAdmin: false };
  });

  it("assinante vê o conteúdo, o menu e o aviso de resposta nova", () => {
    renderAt("/ajuda");
    expect(screen.getByTestId("home")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tutoriais" })).toBeInTheDocument();
    expect(screen.getByLabelText("3 respostas novas")).toBeInTheDocument();
  });

  it("quem não assina vê o aviso e não o conteúdo", () => {
    state.access.data = { allowed: false, reason: "not_subscribed", platformAdmin: false };
    renderAt("/ajuda");
    expect(screen.queryByTestId("home")).not.toBeInTheDocument();
    expect(screen.getByText(/é para clínicas que assinam o Vertexa/)).toBeInTheDocument();
  });

  it("sem login vai para o login e volta para a mesma página depois", () => {
    state.auth.isAuthenticated = false;
    renderAt("/ajuda/suporte");
    expect(screen.getByTestId("login")).toBeInTheDocument();
    expect(peekHelpReturn()).toBe("/ajuda/suporte");
  });
});
