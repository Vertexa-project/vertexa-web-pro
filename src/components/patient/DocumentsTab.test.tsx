import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ upload: vi.fn(async (i: unknown) => i), update: vi.fn(async () => undefined) }));
vi.mock("@/lib/api/documents", () => ({
  ALLOWED_DOCUMENT_MIME: ["application/pdf"],
  MAX_DOCUMENT_SIZE_BYTES: 15 * 1024 * 1024,
  getDocumentSignedUrl: vi.fn(),
  listPatientDocuments: vi.fn(async () => [
    { id: "d1", patient_id: "p", uploaded_by_role: "professional", uploaded_by_professional_id: "pr", kind: "exam", title: "Relatório de progresso.pdf", file_path: "p/1.pdf", mime_type: "application/pdf", file_size_bytes: 10, uploaded_at: "2026-11-10T12:00:00Z", created_at: "2026-11-10T12:00:00Z", uploaded_by_name: "Dra. Ana" },
  ]),
  uploadPatientDocument: api.upload,
  updatePatientDocumentKind: api.update,
}));
vi.mock("@/hooks/useCurrentProfessional", () => ({ useCurrentProfessional: () => ({ data: { id: "pr" } }) }));
vi.mock("@/hooks/useBodyAssessments", () => ({ usePatientDocuments: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn(), isFetching: false }) }));
vi.mock("@/components/documents/ClinicalDocumentsPanel", () => ({ ClinicalDocumentsPanel: () => null }));

import { DocumentsTab } from "./DocumentsTab";

const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DocumentsTab patientId="p" /></QueryClientProvider>);

describe("DocumentsTab: tipo do documento", () => {
  it("relatório de progresso enviado NÃO vira Exame", async () => {
    const { container } = wrap();
    await screen.findByText("Relatório de progresso.pdf");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "evolucao-ana-2026-11-12.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(api.upload).toHaveBeenCalled());
    expect(api.upload).toHaveBeenCalledWith(expect.objectContaining({ kind: "report", title: "evolucao-ana-2026-11-12.pdf" }));
  });
  it("cada documento enviado tem seletor para o profissional trocar o tipo", async () => {
    wrap();
    expect(await screen.findByRole("combobox", { name: /Tipo do documento Relatório de progresso/ })).toBeInTheDocument();
  });
});
