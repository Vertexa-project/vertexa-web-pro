import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const setMode = vi.hoisted(() => vi.fn());
const grant = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAmIPlatformAdmin", () => ({
  useAmIPlatformAdmin: () => ({ isPlatformAdmin: true, isLoading: false }),
}));
vi.mock("@/hooks/useCommercialAccess", () => ({
  usePlatformCommercialAccess: () => ({
    data: {
      rolloutMode: "OBSERVE",
      providerWriteMode: "LOCKED",
      entitlementEnforcement: "OFF",
      clinics: [
        {
          clinicId: "c1",
          clinicName: "Santa Maria",
          clinicStatus: "active",
          accessClass: "PRE_CONTRACT",
          reason: "OBSERVE_ONLY",
          productAllowed: true,
          hasActiveContract: false,
          hasActiveExemption: false,
          hasSandboxAccount: false,
          hasProductionAccount: false,
        },
      ],
      exemptions: [],
      canaryClinics: [],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSetCommercialAccessMode: () => ({ mutateAsync: setMode, isPending: false }),
  useGrantCommercialExemption: () => ({ mutateAsync: grant, isPending: false }),
  useRevokeCommercialExemption: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { PlatformCommercialAccessPage } = await import("./PlatformCommercialAccessPage");

describe("PlatformCommercialAccessPage", () => {
  it("shows OBSERVE classification and does not auto-enable ENFORCE", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <MemoryRouter>
        <PlatformCommercialAccessPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Acesso comercial")).toBeInTheDocument();
    expect(screen.getByText("Santa Maria")).toBeInTheDocument();
    expect(screen.getByText("OBSERVE_ONLY")).toBeInTheDocument();
    expect(screen.getByText("LOCKED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ativar enforcement/i })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: /ativar enforcement/i })).toBeEnabled();
  });
});
