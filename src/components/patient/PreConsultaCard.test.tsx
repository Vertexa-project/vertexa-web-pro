import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  rows: [] as unknown[], files: [] as unknown[], loading: false,
  send: vi.fn(async (): Promise<{ id: string; created: boolean; appointment_id: string | null; appointment_starts_at: string | null }> => ({ id: "n", created: true, appointment_id: null, appointment_starts_at: null })), cancel: vi.fn(async () => undefined),
  openFile: vi.fn(async () => "https://signed.example/x"),
}));
vi.mock("@/hooks/usePreConsulta", () => ({
  usePreConsultas: () => ({ data: h.rows, isLoading: h.loading, isError: false, refetch: vi.fn() }),
  usePreConsultaFiles: () => ({ data: h.files }),
  useSendPreConsulta: () => ({ mutateAsync: h.send, isPending: false }),
  useCancelPreConsulta: () => ({ mutateAsync: h.cancel, isPending: false }),
  useOpenPreConsultaFile: () => ({ mutateAsync: h.openFile, isPending: false }),
}));

import { PreConsultaCard } from "./PreConsultaCard";
import { DEFAULT_QUESTIONS } from "@/lib/domain/preConsulta";

const row = (o: object) => ({ id: "r1", patient_id: "p", appointment_id: "a", appointment_starts_at: "2026-11-25T15:00:00Z", status: "enviada", source: "auto", questions: DEFAULT_QUESTIONS, answers: {}, sent_at: "2026-11-20T12:00:00Z", answered_at: null, canceled_at: null, ...o });

beforeEach(() => { h.rows = []; h.files = []; h.loading = false; h.send.mockClear(); h.cancel.mockClear(); h.openFile.mockClear(); });

describe("Cartão Pré-consulta na ficha (A1)", () => {
  it("sem pedido: explica e oferece Enviar pré-consulta", async () => {
    render(<PreConsultaCard patientId="p" />);
    expect(screen.getByText(/Nenhuma pré-consulta enviada/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Enviar pré-consulta/ }));
    await waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Pré-consulta enviada ao app do paciente.")).toBeInTheDocument();
  });
  it("enviada: status com data, consulta, e botão vira Cancelar pedido", async () => {
    h.rows = [row({})];
    render(<PreConsultaCard patientId="p" />);
    expect(screen.getByText("Enviada em 20/11")).toBeInTheDocument();
    expect(screen.getByText("Consulta de 25/11")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enviar pré-consulta/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Cancelar pedido/ }));
    await waitFor(() => expect(h.cancel).toHaveBeenCalledWith("r1"));
  });
  it("respondida: mostra respostas, exames, resumo com selo Modo demonstração", async () => {
    h.rows = [row({ status: "respondida", answered_at: "2026-11-21T15:00:00Z", answers: { objetivo: "Emagrecer", saude: "Gastrite" } })];
    h.files = [{ document_id: "d1", title: "Hemograma.pdf", file_path: "p/pre-consulta/x.pdf", mime_type: "application/pdf" }];
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<PreConsultaCard patientId="p" />);
    expect(screen.getByText("Respondida em 21/11")).toBeInTheDocument();
    expect(screen.getByText("Modo demonstração")).toBeInTheDocument();
    expect(screen.getByText("Objetivo: Emagrecer")).toBeInTheDocument();
    expect(screen.getByText("Exames: 1 arquivo anexado")).toBeInTheDocument();
    expect(screen.getByText("Gastrite", { selector: "dd" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Hemograma\.pdf/ }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://signed.example/x", "_blank", "noopener,noreferrer"));
    open.mockRestore();
  });
  it("reenvio com pedido já existente avisa em vez de duplicar", async () => {
    h.rows = [row({ status: "respondida", answered_at: "2026-11-21T15:00:00Z" })];
    h.send.mockResolvedValueOnce({ id: "r1", created: false, appointment_id: "a", appointment_starts_at: null });
    render(<PreConsultaCard patientId="p" />);
    fireEvent.click(screen.getByRole("button", { name: /Enviar pré-consulta/ }));
    expect(await screen.findByText("Já existe uma pré-consulta para esta consulta.")).toBeInTheDocument();
  });
});
