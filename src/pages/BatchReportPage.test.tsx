import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const m = vi.hoisted(() => ({ zip: vi.fn(), single: vi.fn() }));
vi.mock("@/hooks/usePatients", () => ({
  useListPatients: () => ({ data: [{ id: "p1", profile: { full_name: "Ana" } }, { id: "p2", profile: { full_name: "Bia" } }], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/pdf/generateBatchReport", () => ({ downloadBatchZip: m.zip, downloadBatchReport: m.single }));
vi.mock("@/lib/observability/sentry", () => ({ captureException: vi.fn() }));

import { BatchReportPage } from "./BatchReportPage";

beforeEach(() => { m.zip.mockReset(); m.single.mockReset(); m.zip.mockResolvedValue({ includedCount: 2, failedIds: [], total: 2 }); });

describe("Exportar em lote — formato padrão ZIP", () => {
  it("por padrão baixa um ZIP com um PDF por paciente (e não o PDF único)", async () => {
    render(<BatchReportPage />);
    expect(screen.getByText(/ZIP com um relatório PDF por paciente/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Selecionar todos"));
    fireEvent.click(screen.getByRole("button", { name: /Exportar selecionados/ }));
    await waitFor(() => expect(m.zip).toHaveBeenCalled());
    expect(m.single).not.toHaveBeenCalled();
    expect(m.zip.mock.calls[0][0].patientIds).toEqual(["p1", "p2"]);
    expect(await screen.findByRole("status")).toHaveTextContent("Relatório gerado com 2 paciente(s).");
  });
  it("avisa quando só parte entrou", async () => {
    m.zip.mockResolvedValue({ includedCount: 1, failedIds: ["p2"], total: 2 });
    render(<BatchReportPage />);
    fireEvent.click(screen.getByLabelText("Selecionar todos"));
    fireEvent.click(screen.getByRole("button", { name: /Exportar selecionados/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("1 de 2 paciente(s). 1 não incluído(s)");
  });
});
