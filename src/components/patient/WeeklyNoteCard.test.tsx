import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ saved: null as string | null, set: vi.fn(async () => undefined) }));
vi.mock("@/lib/api/weeklyNote", () => ({ getWeeklyNote: vi.fn(async () => api.saved), setWeeklyNote: api.set }));
import { WeeklyNoteCard } from "./WeeklyNoteCard";
import { mondayKey } from "@/lib/domain/weeklyNote";

const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WeeklyNoteCard patientId="p1" /></QueryClientProvider>);
beforeEach(() => { api.saved = null; api.set.mockClear(); });

describe("recado da semana (web)", () => {
  it("salva o texto para a segunda-feira desta semana", async () => {
    wrap();
    const ta = await screen.findByLabelText("Recado da semana");
    fireEvent.change(ta, { target: { value: "Ótima semana!" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar recado" }));
    await waitFor(() => expect(api.set).toHaveBeenCalledWith("p1", mondayKey(new Date()), "Ótima semana!"));
  });
  it("traz o recado salvo e o botão vira 'Voltar ao automático' ao limpar", async () => {
    api.saved = "Vamos ajustar a carga.";
    wrap();
    const ta = await screen.findByLabelText("Recado da semana");
    await waitFor(() => expect(ta).toHaveValue("Vamos ajustar a carga."));
    fireEvent.change(ta, { target: { value: "" } });
    const btn = screen.getByRole("button", { name: "Voltar ao automático" });
    fireEvent.click(btn);
    await waitFor(() => expect(api.set).toHaveBeenCalledWith("p1", mondayKey(new Date()), ""));
  });
  it("bloqueia acima de 300 caracteres e sem mudança não habilita", async () => {
    wrap();
    const ta = await screen.findByLabelText("Recado da semana");
    expect(screen.getByRole("button", { name: "Salvar recado" })).toBeDisabled();
    fireEvent.change(ta, { target: { value: "x".repeat(301) } });
    expect(screen.getByRole("button", { name: "Salvar recado" })).toBeDisabled();
    expect(screen.getByText("301/300")).toBeInTheDocument();
  });
});
