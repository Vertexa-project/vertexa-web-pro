import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import userEvent from "@testing-library/user-event";

import type { PlatformClinic } from "@/lib/api/platformAdmin";
import type { PlatformClinicPixAutomaticStatus } from "@/lib/domain/pixAutomaticReissue";

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

const pixState = vi.hoisted(() => ({
  data: [] as PlatformClinicPixAutomaticStatus[] | undefined,
  reissue: vi.fn(),
  reissuePending: false,
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
  usePlatformClinicPixStatuses: () => ({
    data: pixState.data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useReissuePixAutomaticAuthorization: () => ({
    mutateAsync: pixState.reissue,
    isPending: pixState.reissuePending,
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
  pixState.data = [];
  pixState.reissue.mockReset();
  pixState.reissuePending = false;
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
    expect(api).toContain("list_platform_clinic_pix_automatic_statuses");
    expect(api).toContain("reissue_pix_automatic_authorization");
    expect(api).not.toContain(".from(");
    expect(api).not.toContain("SERVICE_ROLE");
    expect(api).not.toContain("ASAAS_API_KEY");
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

function pix(over: Partial<PlatformClinicPixAutomaticStatus> = {}): PlatformClinicPixAutomaticStatus {
  return {
    clinicId: "clinic-SHOULD-NOT-APPEAR-abc",
    commercialContractId: "contract-SHOULD-NOT-APPEAR",
    authorizationId: "auth-SHOULD-NOT-APPEAR",
    providerStatus: "REFUSED",
    generation: 1,
    ...over,
  };
}

describe("PlatformClinicsPage — Pix Automático reissue", () => {
  it("REFUSED mostra Recusado e o CTA", () => {
    clinicsState.data = [clinic()];
    pixState.data = [pix({ providerStatus: "REFUSED" })];
    render(<PlatformClinicsPage />);
    expect(screen.getByText("Recusado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gerar nova autorização" })).toBeInTheDocument();
  });

  it.each(["ACTIVE", "CREATED", "INTENT", "CANCELLED", "EXPIRED"] as const)(
    "%s esconde o CTA",
    (status) => {
      clinicsState.data = [clinic()];
      pixState.data = [pix({ providerStatus: status })];
      render(<PlatformClinicsPage />);
      expect(screen.queryByRole("button", { name: "Gerar nova autorização" })).not.toBeInTheDocument();
    },
  );

  it("Cancelar no dialog não chama o backend", async () => {
    const user = userEvent.setup();
    clinicsState.data = [clinic()];
    pixState.data = [pix()];
    render(<PlatformClinicsPage />);
    await user.click(screen.getByRole("button", { name: "Gerar nova autorização" }));
    expect(screen.getByText("Gerar nova autorização Pix Automático?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(pixState.reissue).not.toHaveBeenCalled();
  });

  it("Confirmar chama o backend uma vez e não mostra ids de provider", async () => {
    const user = userEvent.setup();
    pixState.reissue.mockResolvedValue({
      outcome: "reissued",
      oldAuthorizationId: "old",
      newAuthorizationId: "new",
      oldGeneration: 1,
      newGeneration: 2,
      newStatus: "INTENT",
      operationId: null,
    });
    clinicsState.data = [clinic()];
    pixState.data = [pix()];
    render(<PlatformClinicsPage />);
    await user.click(screen.getByRole("button", { name: "Gerar nova autorização" }));
    const confirms = screen.getAllByRole("button", { name: "Gerar nova autorização" });
    await user.click(confirms[confirms.length - 1]);
    expect(pixState.reissue).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("auth-SHOULD-NOT-APPEAR")).not.toBeInTheDocument();
    expect(screen.queryByText("contract-SHOULD-NOT-APPEAR")).not.toBeInTheDocument();
    expect(screen.queryByText(/cus_|pay_|asaas/i)).not.toBeInTheDocument();
  });

  it("desabilita o confirm enquanto pending", () => {
    clinicsState.data = [clinic()];
    pixState.data = [pix()];
    pixState.reissuePending = true;
    render(<PlatformClinicsPage />);
    expect(screen.getByRole("button", { name: "Gerar nova autorização" })).toBeDisabled();
  });

  it("erro seguro não mostra SQL", async () => {
    const user = userEvent.setup();
    pixState.reissue.mockRejectedValue(new Error("authorization_not_refused"));
    clinicsState.data = [clinic()];
    pixState.data = [pix()];
    render(<PlatformClinicsPage />);
    await user.click(screen.getByRole("button", { name: "Gerar nova autorização" }));
    const confirms = screen.getAllByRole("button", { name: "Gerar nova autorização" });
    await user.click(confirms[confirms.length - 1]);
    expect(await screen.findByText(/estado atual é Recusado/)).toBeInTheDocument();
    expect(screen.queryByText(/BILLING_|SQL|postgres/i)).not.toBeInTheDocument();
  });
});
