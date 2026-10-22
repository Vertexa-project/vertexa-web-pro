import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ list: vi.fn(), exec: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/api/accountDeletion", () => ({ listOpenDeletionRequests: api.list, executeAccountDeletion: api.exec, removeStoredFiles: api.remove }));
import { AccountDeletionCard } from "./AccountDeletionCard";

const R = { id: "r1", patientId: "t1", patientName: "Ana Paciente", requestedAt: "2026-10-20T12:00:00Z" };
const renderIt = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AccountDeletionCard /></QueryClientProvider>);
beforeEach(() => { api.list.mockReset().mockResolvedValue([R]); api.exec.mockReset().mockResolvedValue([{ bucket: "b", path: "p" }]); api.remove.mockReset().mockResolvedValue(0); });

describe("AccountDeletionCard", () => {
  it("sem pedidos, não aparece", async () => {
    api.list.mockResolvedValue([]);
    const { container } = renderIt();
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
  it("exige confirmação: o primeiro clique não exclui", async () => {
    renderIt();
    fireEvent.click(await screen.findByText("Excluir conta"));
    expect(api.exec).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Voltar"));
    expect(screen.getByText("Excluir conta")).toBeInTheDocument();
  });
  it("confirmar executa, remove os arquivos e avisa que o histórico foi mantido", async () => {
    renderIt();
    fireEvent.click(await screen.findByText("Excluir conta"));
    fireEvent.click(screen.getByText("Confirmar exclusão"));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("r1", [{ bucket: "b", path: "p" }]));
    expect(await screen.findByRole("status")).toHaveTextContent("anonimizada. O histórico clínico foi mantido");
  });
  it("arquivos que não saíram são avisados, sem dizer que deu tudo certo", async () => {
    api.remove.mockResolvedValue(2);
    renderIt();
    fireEvent.click(await screen.findByText("Excluir conta"));
    fireEvent.click(screen.getByText("Confirmar exclusão"));
    expect(await screen.findByRole("status")).toHaveTextContent("2 arquivo(s) não saíram");
  });
  it("se o banco recusa, avisa que nada mudou", async () => {
    api.exec.mockRejectedValue(new Error("x"));
    renderIt();
    fireEvent.click(await screen.findByText("Excluir conta"));
    fireEvent.click(screen.getByText("Confirmar exclusão"));
    expect(await screen.findByRole("status")).toHaveTextContent("Nada foi alterado");
    expect(api.remove).not.toHaveBeenCalled();
  });
});
