import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const origin = vi.hoisted(() => ({ value: null as null | { source_filename: string; imported_at: string } }));
vi.mock("@/lib/api/timeline", () => ({ getPatientTimeline: vi.fn(async () => []) }));
vi.mock("@/lib/api/patientImportExport", () => ({ getPatientImportOrigin: vi.fn(async () => origin.value) }));
const { TimelineTab } = await import("./TimelineTab");

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TimelineTab patientId="p1" />
    </QueryClientProvider>,
  );

describe("TimelineTab — origem do cadastro", () => {
  it("paciente importado mostra 'Importado de <arquivo>' mesmo sem outras atividades", async () => {
    origin.value = { source_filename: "pacientes_teste.csv", imported_at: "2026-11-16T15:00:00Z" };
    show();
    expect(await screen.findByText("Importado de pacientes_teste.csv")).toBeInTheDocument();
    expect(screen.getByText(/Cadastro criado por importação de planilha/)).toBeInTheDocument();
    expect(screen.queryByText("Sem atividades ainda")).toBeNull();
  });
  it("paciente cadastrado à mão não mostra origem", async () => {
    origin.value = null;
    show();
    expect(await screen.findByText("Sem atividades ainda")).toBeInTheDocument();
    expect(screen.queryByText(/Importado de/)).toBeNull();
  });
});
