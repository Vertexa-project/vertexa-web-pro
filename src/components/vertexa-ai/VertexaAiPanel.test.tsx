import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

const PID = "cc2a636b-aec9-4132-afe7-475d293d67de";
const api = vi.hoisted(() => ({ ask: vi.fn(), resolve: vi.fn() }));
vi.mock("@/hooks/useFin", () => ({ useFinContext: () => ({ clinicId: "c1", access: { isAdmin: true, roles: [], can: {} }, isLoading: false }) }));
vi.mock("@/lib/api/vertexaAi", () => ({
  askVertexaAi: api.ask,
  resolveVertexaDraft: api.resolve,
  friendlyAiError: (c: string) => (c === "not_deployed" ? "A Vertexa IA ainda não está ativa neste ambiente." : "Erro genérico"),
}));
vi.mock("@/hooks/usePatients", () => ({
  usePatient: (id: string) => ({ data: id ? { profile: { full_name: "Mariana Teste" } } : undefined }),
}));
vi.mock("@/hooks/useCurrentProfessional", () => ({ useCurrentProfessionalName: () => ({ data: "Dra. Juliana Souza" }) }));

import { VertexaAiButton } from "./VertexaAiButton";
import { VertexaAiProvider } from "./VertexaAiProvider";

const msgReply = {
  mode: "demo" as const, request_id: "req-1", traced: true,
  reply: {
    text: "Rascunho de mensagem para Mariana Teste. Nada foi enviado.",
    items: [{ text: "Peso atual: 70 kg", source: "Última medida válida · 12/11" }, { text: "Adesão: sem dado", source: "App do paciente", uncertain: true }],
    draft: { kind: "mensagem" as const, title: "Mensagem para Mariana Teste", patientId: PID, patientName: "Mariana Teste", body: "Oi, Mariana! Faz alguns dias.", fields: [] },
    actions: [{ label: "Abrir conversa", to: `/mensagens?patient=${PID}` }],
    blocked: null,
  },
};

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}{l.search}</p>;
}
function setup(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <VertexaAiProvider>
        <VertexaAiButton variant="topbar" />
        <Where />
      </VertexaAiProvider>
    </MemoryRouter>,
  );
}

describe("painel Vertexa IA", () => {
  beforeEach(() => {
    api.ask.mockReset();
    api.resolve.mockReset();
    sessionStorage.clear();
  });

  it("mostra o contexto: Hoje na tela inicial; paciente e aba na ficha", () => {
    const { unmount } = setup("/");
    fireEvent.click(screen.getByRole("button", { name: "Abrir a Vertexa IA" }));
    expect(screen.getByTestId("vertexa-ai-context").textContent).toBe("Vendo: Hoje");
    expect(screen.getByRole("button", { name: "Quem eu devo ligar hoje?" })).toBeTruthy();
    expect(screen.getByText(/nada é salvo sem a sua confirmação/)).toBeTruthy();
    unmount();
    setup(`/pacientes/${PID}?tab=prontuario`);
    fireEvent.click(screen.getByRole("button", { name: "Abrir a Vertexa IA" }));
    expect(screen.getByTestId("vertexa-ai-context").textContent).toBe("Vendo: Mariana Teste · Prontuário");
    expect(screen.getByRole("button", { name: "Prepara o resumo para o retorno" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Quem eu devo ligar hoje?" })).toBeNull();
  });

  it("pedido leva a tela e o paciente; resposta vem como rascunho com fonte, incerto e modo demonstração", async () => {
    api.ask.mockResolvedValue(msgReply);
    setup(`/pacientes/${PID}`);
    fireEvent.click(screen.getByRole("button", { name: "Abrir a Vertexa IA" }));
    fireEvent.click(screen.getByRole("button", { name: "Escreve um rascunho de mensagem para este paciente" }));
    await screen.findByText("Mensagem para Mariana Teste");
    expect(api.ask).toHaveBeenCalledWith("Escreve um rascunho de mensagem para este paciente", { screen: "paciente", patientId: PID, tab: "resumo" });
    expect(screen.getByText("Rascunho · nada foi salvo")).toBeTruthy();
    expect(screen.getAllByText(/fonte: /).length).toBeGreaterThanOrEqual(2);
    const uncertain = screen.getByText("Adesão: sem dado");
    expect(uncertain.className).toMatch(/text-primary-ink/) // incerto em laranja (guia), não cinza;
    expect(screen.getAllByText("Modo demonstração").length).toBeGreaterThan(0);
    // histórico da sessão: pedido do usuário com a tela em que foi feito
    expect(screen.getByText("Em: Mariana Teste · Resumo")).toBeTruthy();
  });

  it("Usar entrega o texto ao campo de Mensagens, sem enviar nem salvar; rastro é gravado", async () => {
    api.ask.mockResolvedValue(msgReply);
    setup("/");
    fireEvent.click(screen.getByRole("button", { name: "Abrir a Vertexa IA" }));
    fireEvent.click(screen.getByRole("button", { name: "Quem eu devo ligar hoje?" }));
    await screen.findByText("Mensagem para Mariana Teste");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.change(screen.getByLabelText("Texto do rascunho"), { target: { value: "Oi, Mari! Editado." } });
    fireEvent.click(screen.getByRole("button", { name: "Usar em Mensagens" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`/mensagens?patient=${PID}`));
    expect(sessionStorage.getItem(`vertexa-ai:draft:${PID}`)).toBe("Oi, Mari! Editado.");
    expect(api.resolve).toHaveBeenCalledWith("req-1", "usado");
  });

  it("Descartar não guarda nada nem navega", async () => {
    api.ask.mockResolvedValue(msgReply);
    setup("/");
    fireEvent.click(screen.getByRole("button", { name: "Abrir a Vertexa IA" }));
    fireEvent.click(screen.getByRole("button", { name: "Quem eu devo ligar hoje?" }));
    await screen.findByText("Mensagem para Mariana Teste");
    fireEvent.click(screen.getByRole("button", { name: /Descartar/ }));
    expect(screen.getByText("Descartado · nada foi salvo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Usar em Mensagens" })).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(screen.getByTestId("where").textContent).toBe("/");
    expect(api.resolve).toHaveBeenCalledWith("req-1", "descartado");
  });

  it("função fora do ar: mensagem em português, nada criado", async () => {
    api.ask.mockRejectedValue(new Error("not_deployed"));
    setup("/");
    fireEvent.click(screen.getByRole("button", { name: "Abrir a Vertexa IA" }));
    const form = screen.getByRole("textbox", { name: "Peça algo à Vertexa IA" });
    fireEvent.change(form, { target: { value: "oi" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await screen.findByText("A Vertexa IA ainda não está ativa neste ambiente.");
    const panel = screen.getByRole("dialog");
    expect(within(panel).queryByText("Rascunho · nada foi salvo")).toBeNull();
  });

  it("botão sem provider não aparece (telas fora do AppShell)", () => {
    render(<MemoryRouter><VertexaAiButton variant="menu" /></MemoryRouter>);
    expect(screen.queryByText("Vertexa IA")).toBeNull();
  });
});
