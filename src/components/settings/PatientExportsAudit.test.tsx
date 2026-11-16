import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ listPatientExports: vi.fn() }));
vi.mock("@/lib/api/patientImportExport", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/patientImportExport")>("@/lib/api/patientImportExport");
  return { ...actual, listPatientExports: api.listPatientExports };
});
const { PatientExportsAudit } = await import("./PatientExportsAudit");

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PatientExportsAudit clinicId="c1" />
    </QueryClientProvider>,
  );

beforeEach(() => api.listPatientExports.mockReset());

describe("PatientExportsAudit", () => {
  it("lista data (Brasília), quem, motivo, dados e quantidade — sem os dados exportados", async () => {
    api.listPatientExports.mockResolvedValue([
      { id: "e1", actor_name: "Dra. Teste (QA)", reason_kind: "backup", reason_text: "Backup mensal da clínica", fields: ["cadastro", "medidas"], row_count: 142, created_at: "2026-11-16T02:30:00Z" },
    ]);
    show();
    expect(await screen.findByText("15/11/2026, 23:30")).toBeInTheDocument();
    expect(screen.getByText("Dra. Teste (QA)")).toBeInTheDocument();
    expect(screen.getByText(/Backup da clínica — Backup mensal da clínica/)).toBeInTheDocument();
    expect(screen.getByText("Cadastro, Medidas e peso")).toBeInTheDocument();
    expect(screen.getByText("142")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Exportações" })).toBeInTheDocument();
  });
  it("vazio e erro têm estado próprio", async () => {
    api.listPatientExports.mockResolvedValue([]);
    show();
    expect(await screen.findByText("Nenhuma exportação ainda")).toBeInTheDocument();
  });
});
