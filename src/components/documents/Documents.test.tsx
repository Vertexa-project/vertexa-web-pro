import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { DocAccess, DocRow } from "@/lib/api/clinicalDocs";

const h = vi.hoisted(() => ({
  access: {} as Record<string, unknown>, rows: [] as unknown[], items: [] as unknown[],
  api: {
    getDocAccess: vi.fn(), listDocuments: vi.fn(), openSession: vi.fn(), signDemo: vi.fn(), getDocument: vi.fn(), resendDocument: vi.fn(), invalidateDocument: vi.fn(), listPrescribedItems: vi.fn(),
  },
  download: vi.fn(),
}));
vi.mock("@/hooks/useFin", () => ({ useFinContext: () => ({ clinicId: "c1", isLoading: false, access: { isAdmin: false, roles: [], can: {} } }) }));
vi.mock("@/lib/api/clinicalDocs", async (orig) => ({ ...(await orig<typeof import("@/lib/api/clinicalDocs")>()), ...h.api }));
vi.mock("@/lib/pdf/generateClinicalDocumentPdf", () => ({ downloadClinicalDocumentPdf: h.download }));

import { ClinicalDocumentsPanel } from "@/components/documents/ClinicalDocumentsPanel";
import { DocumentsList } from "@/components/documents/DocumentsList";
import { NewDocumentButton } from "@/components/documents/NewDocumentButton";
import { DocumentsPage } from "@/pages/DocumentsPage";

const A = (o: Partial<DocAccess>): DocAccess => ({ kind: "none", can_emit: false, can_list: false, can_content: false, can_resend: false, registry_missing: false, provider: "demo", provider_ready: true, is_demo: true, ...o });
const CLINICAL = A({ kind: "clinical", can_emit: true, can_list: true, can_content: true, can_resend: true });
const FRONT = A({ kind: "front", can_list: true, can_resend: true });
const ROW: DocRow = {
  id: "d1", clinic_id: "c1", patient_id: "p1", patient_name: "Paciente Fictício", encounter_id: null, appointment_id: null, doc_type: "receita", title: "Receita — teste",
  signed_at: "2026-11-15T01:30:00Z", professional_name: "Profissional Fictício", professional_registry: "CRN-3 000001", provider: "demo", is_demo: true, sncr_number: null, item_count: 1,
  invalidated: false, invalidated_at: null, invalidated_reason: null, resend_count: 2,
};
const FULL = { ...ROW, content: "Texto", items: [{ name: "Med", dose: "1", posology: "2x", quantity: "3" }], clinic_name: "Clínica Fictícia", content_hash: "a".repeat(64),
  patient: { name: "Paciente Fictício", birth_date: "1990-05-17", cpf: null, address: null }, professional: { name: "Profissional Fictício", registry_number: "CRN-3 000001", specialty: "Nutrição" } };
const SESSION = {
  session_id: "s1", provider: "demo", is_demo: true, doc_type: "receita", expires_at: "2026-11-19T12:00:00Z",
  patient: { name: "Paciente Fictício", birth_date: "1990-05-17", cpf: null, address: null },
  professional: { id: "pr1", name: "Profissional Fictício", registry_number: "CRN-3 000001", specialty: "Nutrição" },
  clinic: { id: "c1", name: "Clínica Fictícia" }, encounter_id: "e1", appointment_id: null,
};

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  Object.values(h.api).forEach((f) => f.mockReset()); h.download.mockReset();
  h.api.listDocuments.mockResolvedValue([ROW]); h.api.listPrescribedItems.mockResolvedValue([]);
});

describe("botão «Novo documento»", () => {
  it("profissional com registro vê o botão habilitado e escolhe entre Receita, Atestado, Exames e Relatório", async () => {
    h.api.getDocAccess.mockResolvedValue(CLINICAL);
    wrap(<NewDocumentButton patientId="p1" patientName="Paciente Fictício" />);
    const btn = await screen.findByRole("button", { name: /Novo documento/ });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    for (const t of ["Receita", "Atestado", "Exames", "Relatório"]) expect(await screen.findByRole("button", { name: new RegExp(`^${t}`) })).toBeInTheDocument();
  });
  it("sem registro cadastrado o botão fica desabilitado e explica o motivo", async () => {
    h.api.getDocAccess.mockResolvedValue(A({ kind: "clinical", can_list: true, can_content: true, registry_missing: true }));
    wrap(<NewDocumentButton patientId="p1" />);
    const btn = await screen.findByRole("button", { name: /Novo documento/ });
    expect(btn).toBeDisabled(); expect(btn).toHaveAttribute("title", expect.stringMatching(/conselho\/registro/));
  });
  it("Recepção, Financeiro e Estoquista não veem o botão", async () => {
    for (const a of [FRONT, A({})]) {
      h.api.getDocAccess.mockResolvedValue(a);
      const { unmount } = wrap(<NewDocumentButton patientId="p1" />);
      await waitFor(() => expect(h.api.getDocAccess).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: /Novo documento/ })).toBeNull();
      unmount();
    }
  });
  it("fluxo completo: tipo → diálogo do provedor preenchido com faixa de demonstração → valida → assina → baixa o PDF", async () => {
    h.api.getDocAccess.mockResolvedValue(CLINICAL);
    h.api.openSession.mockResolvedValue(SESSION);
    h.api.signDemo.mockResolvedValue({ document_id: "d9", already: false });
    h.api.getDocument.mockResolvedValue(FULL);
    wrap(<NewDocumentButton patientId="p1" patientName="Paciente Fictício" encounterId="e1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Novo documento/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Receita/ }));
    expect(await screen.findByTestId("doc-demo-banner")).toHaveTextContent(/não tem validade legal/);
    expect(h.api.openSession).toHaveBeenCalledWith("c1", "p1", "receita", "e1", undefined);
    expect(screen.getByText("Paciente Fictício", { selector: "p.font-medium" })).toBeInTheDocument();
    expect(screen.getByText(/CRN-3 000001 · Nutrição/)).toBeInTheDocument();
    expect(screen.getByText("Clínica Fictícia")).toBeInTheDocument();
    // sem itens preenchidos: recusa com mensagem
    fireEvent.click(screen.getByRole("button", { name: /Assinar \(demonstração\)/ }));
    expect(await screen.findByText(/Preencha medicamento, dose, posologia e quantidade/)).toBeInTheDocument();
    expect(h.api.signDemo).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Medicamento"), { target: { value: "Medicamento Fictício" } });
    fireEvent.change(screen.getByLabelText("Dose"), { target: { value: "1 comprimido" } });
    fireEvent.change(screen.getByLabelText("Posologia"), { target: { value: "1x ao dia" } });
    fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(/CPF do paciente/), { target: { value: "111.444.777-35" } });
    fireEvent.click(screen.getByRole("button", { name: /Assinar \(demonstração\)/ }));
    await waitFor(() => expect(h.api.signDemo).toHaveBeenCalledTimes(1));
    expect(h.api.signDemo).toHaveBeenCalledWith("s1", "Receita", "", [{ name: "Medicamento Fictício", dose: "1 comprimido", posology: "1x ao dia", quantity: "30" }], { cpf: "11144477735" });
    expect(await screen.findByText(/Documento assinado \(demonstração, sem validade legal\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Baixar PDF/ }));
    await waitFor(() => expect(h.download).toHaveBeenCalledWith(FULL));
  });
  it("erro do servidor (registro removido) aparece no diálogo e não fecha a tela", async () => {
    h.api.getDocAccess.mockResolvedValue(CLINICAL);
    h.api.openSession.mockResolvedValue({ ...SESSION, doc_type: "atestado" });
    h.api.signDemo.mockRejectedValue({ message: "REGISTRY_REQUIRED", code: "42501" });
    wrap(<NewDocumentButton patientId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Novo documento/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Atestado/ }));
    fireEvent.change(await screen.findByLabelText("Texto do documento"), { target: { value: "Repouso de 2 dias." } });
    fireEvent.click(screen.getByRole("button", { name: /Assinar \(demonstração\)/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/conselho\/registro/);
  });
  it("sessão que o servidor recusa (sem acesso ao paciente) mostra a mensagem e deixa voltar", async () => {
    h.api.getDocAccess.mockResolvedValue(CLINICAL);
    h.api.openSession.mockRejectedValue({ message: "forbidden", code: "42501" });
    wrap(<NewDocumentButton patientId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Novo documento/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Exames/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/permissão/);
    expect(screen.getByRole("button", { name: "Voltar" })).toBeInTheDocument();
  });
});

describe("lista de documentos por papel", () => {
  it("profissional vê a lista, com tipo, marca de demonstração e data em Brasília, e pode abrir; sem reenvio contado", async () => {
    h.api.getDocAccess.mockResolvedValue(CLINICAL);
    wrap(<DocumentsList filter={{ patientId: "p1" }} />);
    expect(await screen.findByText("Receita — teste")).toBeInTheDocument();
    expect(screen.getByText("Demonstração")).toBeInTheDocument();
    expect(screen.getByText(/14\/11\/2026/)).toBeInTheDocument(); // 15/11 01:30 UTC = 14/11 22:30 em Brasília
    expect(screen.getByRole("button", { name: "Abrir" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reenviar/ })).toBeInTheDocument();
    expect(h.api.listDocuments).toHaveBeenCalledWith("c1", { patientId: "p1" });
  });
  it("Recepção vê a lista e Reenviar (baixa o PDF e registra), mas NÃO tem «Abrir» nem «Novo documento»", async () => {
    h.api.getDocAccess.mockResolvedValue(FRONT);
    h.api.resendDocument.mockResolvedValue(FULL);
    wrap(<DocumentsList filter={{}} showPatient />);
    expect(await screen.findByText("Receita — teste")).toBeInTheDocument();
    expect(screen.getByText("Paciente Fictício")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reenviar/ }));
    await waitFor(() => expect(h.download).toHaveBeenCalledWith(FULL));
    expect(h.api.resendDocument).toHaveBeenCalledWith("d1");
    expect(await screen.findByRole("status")).toHaveTextContent(/nada é enviado ao paciente por WhatsApp ou e-mail/);
  });
  it("documento invalidado mostra a marca e não oferece Reenviar", async () => {
    h.api.getDocAccess.mockResolvedValue(FRONT);
    h.api.listDocuments.mockResolvedValue([{ ...ROW, invalidated: true }]);
    wrap(<DocumentsList filter={{}} />);
    expect(await screen.findByText("Invalidado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reenviar/ })).toBeNull();
  });
  it("Financeiro/Estoquista: nada é pedido ao servidor e nada aparece", async () => {
    h.api.getDocAccess.mockResolvedValue(A({}));
    const { container } = wrap(<><DocumentsList filter={{}} /><ClinicalDocumentsPanel patientId="p1" /></>);
    await waitFor(() => expect(h.api.getDocAccess).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(h.api.listDocuments).not.toHaveBeenCalled(); expect(h.api.listPrescribedItems).not.toHaveBeenCalled();
  });
  it("lista vazia, erro e carregando têm estado próprio", async () => {
    h.api.getDocAccess.mockResolvedValue(CLINICAL);
    h.api.listDocuments.mockResolvedValue([]);
    const a = wrap(<DocumentsList filter={{}} emptyText="Nenhum documento emitido ainda." />);
    expect(await screen.findByText("Nenhum documento emitido ainda.")).toBeInTheDocument();
    a.unmount();
    h.api.listDocuments.mockRejectedValue(new Error("x"));
    wrap(<DocumentsList filter={{}} />);
    expect(await screen.findByRole("button", { name: /tentar/i })).toBeInTheDocument();
  });
});

describe("itens prescritos como dado", () => {
  it("mostra a sugestão do estoque da clínica, sem baixar nada", async () => {
    h.api.getDocAccess.mockResolvedValue(CLINICAL);
    h.api.listPrescribedItems.mockResolvedValue([
      { document_id: "d1", signed_at: ROW.signed_at, is_demo: true, encounter_id: null, appointment_id: null, name: "Semaglutida 1 mg/mL", dose: "0,25 mg", posology: "1x por semana", quantity: "1 caneta", stock_suggestion: { item_id: "i1", name: "Semaglutida", stock_unit: "caneta" } },
      { document_id: "d1", signed_at: ROW.signed_at, is_demo: true, encounter_id: null, appointment_id: null, name: "Vitamina Z", dose: "1", posology: "1x", quantity: "30", stock_suggestion: null },
    ]);
    wrap(<ClinicalDocumentsPanel patientId="p1" patientName="Paciente Fictício" />);
    expect(await screen.findByText("Sugestão: Semaglutida")).toBeInTheDocument();
    expect(screen.getByText("sem item correspondente")).toBeInTheDocument();
    expect(screen.getByText(/nenhum estoque é baixado automaticamente/)).toBeInTheDocument();
    expect(h.api.listPrescribedItems).toHaveBeenCalledWith("c1", "p1", { encounterId: undefined, appointmentId: undefined });
  });
});

describe("página Documentos (achado D49)", () => {
  it("mostra uma única faixa de demonstração e os filtros mudam a consulta (tipo, situação, período, busca)", async () => {
    h.api.getDocAccess.mockResolvedValue(CLINICAL);
    wrap(<DocumentsPage />);
    expect(await screen.findByText("Receita — teste")).toBeInTheDocument();
    expect(screen.getAllByTestId("doc-demo-banner")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "exames" } });
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "invalidated" } });
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("Paciente ou título"), { target: { value: "Fict" } });
    await waitFor(() => expect(h.api.listDocuments).toHaveBeenLastCalledWith("c1", { docType: "exames", from: "2026-11-01", to: null, status: "invalidated", search: "Fict" }));
  });
});
