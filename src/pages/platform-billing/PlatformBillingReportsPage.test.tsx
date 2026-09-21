import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { emptyPlatformBillingReport } from "@/lib/domain/platformBillingReports";
import type { PlatformBillingReport } from "@/lib/domain/platformBillingReports";

const reportState = vi.hoisted(() => ({
  data: undefined as PlatformBillingReport | undefined,
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: vi.fn(),
}));

const exportMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAmIPlatformAdmin", () => ({
  useAmIPlatformAdmin: () => ({ isPlatformAdmin: true, isLoading: false, isError: false }),
}));

vi.mock("@/hooks/usePlatformBilling", () => ({
  usePlatformBillingReport: () => reportState,
}));

vi.mock("@/lib/api/platformBillingReports", () => ({
  listPlatformBillingReportExport: exportMock,
}));

vi.mock("@/lib/domain/billingCsv", async () => {
  const actual = await vi.importActual<typeof import("@/lib/domain/billingCsv")>(
    "@/lib/domain/billingCsv",
  );
  return { ...actual, downloadCsvFile: downloadMock };
});

const { PlatformBillingReportsPage } = await import("./PlatformBillingReportsPage");

beforeEach(() => {
  reportState.data = {
    ...emptyPlatformBillingReport({ start: "2026-09-01", end: "2026-09-30" }),
    financial: {
      sandbox: {
        receivedCents: 40000,
        receivedCount: 1,
        pendingCents: 0,
        pendingCount: 0,
        overdueCents: 0,
        overdueCount: 0,
      },
      production: {
        receivedCents: 0,
        receivedCount: 0,
        pendingCents: 0,
        pendingCount: 0,
        overdueCents: 0,
        overdueCount: 0,
      },
    },
    receivedByPlan: [
      {
        environment: "sandbox",
        planCode: "pulse",
        planDisplayName: "Pulse",
        planAttribution: "contract",
        receivedCents: 40000,
        paymentCount: 1,
      },
    ],
    paymentsByStatus: [{ environment: "sandbox", status: "received", paymentCount: 1, amountCents: 40000 }],
    activePixAutomaticAuthorizations: 1,
    delinquentClinics: 0,
    delinquentItems: [],
  };
  reportState.isLoading = false;
  reportState.isError = false;
  exportMock.mockReset();
  downloadMock.mockReset();
});

describe("PlatformBillingReportsPage", () => {
  it("renders the operational report instead of the stub", () => {
    render(<PlatformBillingReportsPage />);
    expect(screen.queryByText("Relatórios em breve")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Relatórios operacionais" })).toBeInTheDocument();
    expect(screen.getByLabelText("Início")).toBeInTheDocument();
    expect(screen.getByLabelText("Fim")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recebido por plano" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pagamentos por situação" })).toBeInTheDocument();
    expect(screen.getByText(/Pix Automático ativo/)).toBeInTheDocument();
    expect(screen.getByText("Nenhuma clínica inadimplente")).toBeInTheDocument();
    expect(screen.getByText(/não é MRR/i)).toBeInTheDocument();
  });

  it("shows loading, empty and error states", () => {
    reportState.isLoading = true;
    const { rerender } = render(<PlatformBillingReportsPage />);
    expect(document.querySelector('[class*="animate-pulse"], .h-64')).toBeTruthy();

    reportState.isLoading = false;
    reportState.isError = true;
    reportState.error = { hint: "BILLING_NOT_PLATFORM_ADMIN" };
    rerender(<PlatformBillingReportsPage />);
    expect(screen.getByText("Não foi possível carregar os relatórios")).toBeInTheDocument();

    reportState.isError = false;
    reportState.data = emptyPlatformBillingReport({ start: "2026-09-01", end: "2026-09-30" });
    rerender(<PlatformBillingReportsPage />);
    expect(screen.getByText("Nenhum recebimento neste recorte")).toBeInTheDocument();
    expect(screen.getByText("Nenhum pagamento neste recorte")).toBeInTheDocument();
  });

  it("exports CSV and reports a no-data export without inventing rows", async () => {
    const user = userEvent.setup();
    exportMock.mockResolvedValueOnce({
      timezone: "America/Sao_Paulo",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      kind: "payments",
      limit: 500,
      offset: 0,
      maxLimit: 500,
      items: [],
    });
    render(<PlatformBillingReportsPage />);
    await user.click(screen.getByRole("button", { name: "Exportar CSV" }));
    expect(exportMock).toHaveBeenCalled();
    expect(downloadMock).not.toHaveBeenCalled();
    expect(screen.getByText("Não há linhas neste recorte para exportar.")).toBeInTheDocument();
  });

  it("downloads CSV when the export page has rows", async () => {
    const user = userEvent.setup();
    exportMock.mockResolvedValueOnce({
      timezone: "America/Sao_Paulo",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      kind: "payments",
      limit: 500,
      offset: 0,
      maxLimit: 500,
      items: [{ rowKind: "payment", clinicName: "Norte", amountCents: 39000 }],
    });
    render(<PlatformBillingReportsPage />);
    await user.click(screen.getByRole("button", { name: "Exportar CSV" }));
    expect(downloadMock).toHaveBeenCalled();
  });
});
