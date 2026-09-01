import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { PlatformClinic } from "@/lib/api/platformAdmin";
import type { PlatformOnboardingSettings } from "@/lib/api/platformAdmin";

const clinicsState = vi.hoisted(() => ({
  data: [] as PlatformClinic[] | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

const settingsState = vi.hoisted(() => ({
  data: undefined as PlatformOnboardingSettings | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useAmIPlatformAdmin", () => ({
  useAmIPlatformAdmin: () => ({
    isPlatformAdmin: true,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePlatformClinics", () => ({
  usePlatformClinics: () => clinicsState,
}));

vi.mock("@/hooks/usePlatformOnboarding", () => ({
  usePlatformOnboardingSettings: () => settingsState,
}));

const { PlatformDashboardPage } = await import("./PlatformDashboardPage");

beforeEach(() => {
  clinicsState.data = [];
  clinicsState.isLoading = false;
  clinicsState.isError = false;
  settingsState.data = {
    mode: "manual_review",
    updatedAt: "2026-09-01T00:00:00Z",
    updatedByProfileId: "pa",
    updatedByName: "PA",
    pendingRequestCount: 4,
  };
  settingsState.isLoading = false;
  settingsState.isError = false;
});

describe("PlatformDashboardPage", () => {
  it("mostra métricas existentes + pendentes + modo", () => {
    clinicsState.data = [
      {
        clinicId: "a",
        clinicName: "Alfa",
        createdAt: "2026-03-01T00:00:00Z",
        ownerProfileId: "o1",
        professionalCount: 1,
        patientCount: 2,
      },
      {
        clinicId: "b",
        clinicName: "Beta",
        createdAt: "2026-03-02T00:00:00Z",
        ownerProfileId: "o2",
        professionalCount: 2,
        patientCount: 3,
      },
    ];
    render(<PlatformDashboardPage />);
    expect(screen.getByText("Dashboard da plataforma")).toBeInTheDocument();
    expect(screen.getByText("Total de clínicas").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Total de profissionais").parentElement).toHaveTextContent("3");
    expect(screen.getByText("Total de pacientes").parentElement).toHaveTextContent("5");
    expect(screen.getByText("Solicitações pendentes").parentElement).toHaveTextContent("4");
    expect(screen.getByText("Entrada de clínicas").parentElement).toHaveTextContent("Sob análise");
  });

  it("erro não cai em empty de clínicas", () => {
    settingsState.isError = true;
    render(<PlatformDashboardPage />);
    expect(screen.getByText(/não foi possível carregar o dashboard/i)).toBeInTheDocument();
    expect(screen.queryByText(/nenhuma clínica cadastrada/i)).not.toBeInTheDocument();
  });
});
