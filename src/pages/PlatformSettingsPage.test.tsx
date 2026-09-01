import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PlatformOnboardingSettings } from "@/lib/api/platformAdmin";

const settingsState = vi.hoisted(() => ({
  data: undefined as PlatformOnboardingSettings | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

const saveState = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null as unknown,
}));

vi.mock("@/hooks/useAmIPlatformAdmin", () => ({
  useAmIPlatformAdmin: () => ({
    isPlatformAdmin: true,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePlatformOnboarding", () => ({
  usePlatformOnboardingSettings: () => settingsState,
  useSetClinicOnboardingPolicy: () => saveState,
}));

const { PlatformSettingsPage } = await import("./PlatformSettingsPage");

beforeEach(() => {
  settingsState.data = {
    mode: "closed",
    updatedAt: "2026-09-01T00:00:00Z",
    updatedByProfileId: "pa",
    updatedByName: "Neemias",
    pendingRequestCount: 0,
  };
  settingsState.isLoading = false;
  settingsState.isError = false;
  saveState.mutate.mockReset();
  saveState.isPending = false;
  saveState.isError = false;
  saveState.isSuccess = false;
  saveState.error = null;
});

describe("PlatformSettingsPage", () => {
  it("mostra modo atual, auditoria e salva só após ação explícita", async () => {
    const user = userEvent.setup();
    render(<PlatformSettingsPage />);
    expect(screen.getByText(/Modo atual: Fechada/i)).toBeInTheDocument();
    expect(screen.getByText(/Por Neemias/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: /salvar política/i });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /automática/i }));
    expect(save).toBeEnabled();
    await user.click(save);
    expect(saveState.mutate).toHaveBeenCalledWith("automatic");
  });

  it("explica os três modos", () => {
    render(<PlatformSettingsPage />);
    expect(screen.getByText(/ativada na hora/i)).toBeInTheDocument();
    expect(screen.getByText(/aprova ou recusa/i)).toBeInTheDocument();
    expect(screen.getByText(/bloqueadas/i)).toBeInTheDocument();
  });

  it("erro de carga é fail-closed", () => {
    settingsState.data = undefined;
    settingsState.isError = true;
    render(<PlatformSettingsPage />);
    expect(screen.getByText("Não foi possível carregar as configurações")).toBeInTheDocument();
  });
});
