import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { PlatformClinic } from "@/lib/api/platformAdmin";

const clinicsState = vi.hoisted(() => ({
  data: [] as PlatformClinic[] | undefined,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  enabled: undefined as boolean | undefined,
}));

const lifecycleState = vi.hoisted(() => ({
  suspend: vi.fn(),
  reactivate: vi.fn(),
  suspendPending: false,
  reactivatePending: false,
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
  usePlatformClinics: (enabled: boolean) => {
    clinicsState.enabled = enabled;
    return {
      data: clinicsState.data,
      isLoading: clinicsState.isLoading,
      isError: clinicsState.isError,
      refetch: clinicsState.refetch,
    };
  },
  useSuspendPlatformClinic: () => ({
    mutateAsync: lifecycleState.suspend,
    isPending: lifecycleState.suspendPending,
  }),
  useReactivatePlatformClinic: () => ({
    mutateAsync: lifecycleState.reactivate,
    isPending: lifecycleState.reactivatePending,
  }),
}));

const { PlatformClinicsPage } = await import("./PlatformClinicsPage");

function clinic(over: Partial<PlatformClinic> = {}): PlatformClinic {
  return {
    clinicId: "clinic-SHOULD-NOT-APPEAR-abc",
    clinicName: "Clínica Horizonte",
    createdAt: "2026-03-01T00:00:00Z",
    ownerProfileId: "owner-SHOULD-NOT-APPEAR-xyz",
    professionalCount: 1,
    patientCount: 2,
    status: "active",
    statusChangedAt: null,
    statusReason: null,
    ...over,
  };
}

beforeEach(() => {
  clinicsState.data = [];
  clinicsState.isLoading = false;
  clinicsState.isError = false;
  clinicsState.enabled = undefined;
  lifecycleState.suspend.mockReset();
  lifecycleState.reactivate.mockReset();
  lifecycleState.suspendPending = false;
  lifecycleState.reactivatePending = false;
});

describe("PlatformClinicsPage — catálogo V1", () => {
  it("T11/T12 — catálogo mostra as clínicas sem ids internos", () => {
    clinicsState.data = [
      clinic({ clinicId: "a", clinicName: "Alfa", professionalCount: 1, patientCount: 2 }),
      clinic({
        clinicId: "b",
        clinicName: "Beta",
        professionalCount: 2,
        patientCount: 3,
        ownerProfileId: "owner-SHOULD-NOT-APPEAR-xyz",
      }),
    ];
    clinicsState.isLoading = false;
    clinicsState.isError = false;

    render(<PlatformClinicsPage />);

    expect(screen.getByText("Clínicas")).toBeInTheDocument();
    expect(screen.getByText("Alfa")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(clinicsState.enabled).toBe(true);
  });

  it("T13 — clinic_id e owner_profile_id não aparecem na UI", () => {
    clinicsState.data = [clinic()];
    clinicsState.isLoading = false;
    clinicsState.isError = false;

    render(<PlatformClinicsPage />);

    expect(screen.queryByText("clinic-SHOULD-NOT-APPEAR-abc")).not.toBeInTheDocument();
    expect(screen.queryByText("owner-SHOULD-NOT-APPEAR-xyz")).not.toBeInTheDocument();
    expect(screen.getByText("Clínica Horizonte")).toBeInTheDocument();
  });

  it("lista vazia mostra empty state (sem hardcodar 2 clínicas)", () => {
    clinicsState.data = [];
    clinicsState.isLoading = false;
    clinicsState.isError = false;
    render(<PlatformClinicsPage />);
    expect(screen.getByText("Nenhuma clínica cadastrada")).toBeInTheDocument();
  });

  it("erro da lista é fail-closed (sem fallback clínico)", () => {
    clinicsState.data = undefined;
    clinicsState.isLoading = false;
    clinicsState.isError = true;
    render(<PlatformClinicsPage />);
    expect(screen.getByText("Não foi possível carregar as clínicas")).toBeInTheDocument();
  });
});

describe("PlatformClinicsPage — T14 fronteira de dados", () => {
  it("página, hook e API não consultam patients/chat/adherence/clinic admin", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(dir, "..");
    const files = [
      path.join(dir, "PlatformClinicsPage.tsx"),
      path.join(root, "hooks", "usePlatformClinics.ts"),
      path.join(root, "lib", "api", "platformAdmin.ts"),
      path.join(root, "layouts", "PlatformShell.tsx"),
      path.join(dir, "PlatformDashboardPage.tsx"),
      path.join(dir, "PlatformRequestsPage.tsx"),
      path.join(dir, "PlatformSettingsPage.tsx"),
    ];
    const forbidden = [
      "useListPatients",
      "useUnreadMentions",
      "useIsClinicAdmin",
      "StaffNotificationsBell",
      "am_i_clinic_admin",
      "create_clinic_with_owner",
      "adherence_snapshots",
      "chat_channels",
      "chat_messages",
      "staff_notifications",
      "professional_patient_links",
      "from(\"patients\")",
    ];

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const token of forbidden) {
        expect(src, `${path.basename(file)} contém ${token}`).not.toContain(token);
      }
    }

    const api = readFileSync(path.join(root, "lib", "api", "platformAdmin.ts"), "utf8");
    expect(api).toContain("am_i_platform_admin");
    expect(api).toContain("list_platform_clinics");
    expect(api).toContain("list_clinic_creation_requests");
    expect(api).toContain("set_clinic_onboarding_policy");
    expect(api).toContain("suspend_platform_clinic");
    expect(api).toContain("reactivate_platform_clinic");
    expect(api).not.toContain(".from(");
  });
});

describe("PlatformClinicsPage — lifecycle S27/S28", () => {
  it("mostra badge Ativa e ação Suspender", () => {
    clinicsState.data = [clinic({ clinicName: "Horizonte", status: "active" })];
    render(<PlatformClinicsPage />);
    expect(screen.getByText("Ativa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suspender" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reativar" })).not.toBeInTheDocument();
  });

  it("mostra badge Suspensa, motivo e ação Reativar", () => {
    clinicsState.data = [
      clinic({
        clinicName: "Horizonte",
        status: "suspended",
        statusChangedAt: "2026-09-02T00:00:00Z",
        statusReason: "inadimplencia de teste",
      }),
    ];
    render(<PlatformClinicsPage />);
    expect(screen.getByText("Suspensa")).toBeInTheDocument();
    expect(screen.getByText(/inadimplencia de teste/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reativar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspender" })).not.toBeInTheDocument();
  });
});
