import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  admin: true, adminLoading: false, data: { auto_send: false, questions: null } as { auto_send: boolean; questions: unknown },
  save: vi.fn(async (_v: { autoSend: boolean; questions: Array<{ label: string }> | null }) => undefined),
}));
vi.mock("@/hooks/useCurrentProfessional", () => ({ useCurrentProfessional: () => ({ data: { clinicId: "c1" } }) }));
vi.mock("@/hooks/useIsClinicAdmin", () => ({ useIsClinicAdmin: () => ({ isClinicAdmin: h.admin, isLoading: h.adminLoading }) }));
vi.mock("@/hooks/usePreConsulta", () => ({
  usePreConsultaSettings: () => ({ data: h.data, isLoading: false, isError: false }),
  useSavePreConsultaSettings: () => ({ mutateAsync: h.save, isPending: false }),
}));

import { PreConsultaSettingsPage } from "./PreConsultaSettingsPage";
import { DEFAULT_QUESTIONS } from "@/lib/domain/preConsulta";

beforeEach(() => { h.admin = true; h.adminLoading = false; h.data = { auto_send: false, questions: null }; h.save.mockClear(); });

describe("Configurações › Pré-consulta (A1)", () => {
  it("quem não é admin da clínica não configura", () => {
    h.admin = false;
    render(<PreConsultaSettingsPage />);
    expect(screen.getByText(/Apenas o administrador da clínica/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar" })).toBeNull();
  });
  it("nasce desligado, mostra as perguntas padrão e salva ligado sem guardar cópia do padrão", async () => {
    render(<PreConsultaSettingsPage />);
    const box = screen.getByRole("checkbox");
    expect(box).not.toBeChecked();
    expect(screen.getAllByLabelText(/Texto da pergunta/)).toHaveLength(DEFAULT_QUESTIONS.length);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ autoSend: true, questions: null }));
    expect(await screen.findByText("Configuração salva.")).toBeInTheDocument();
  });
  it("editar, remover e adicionar pergunta salva a lista da clínica; pergunta vazia é barrada", async () => {
    render(<PreConsultaSettingsPage />);
    fireEvent.change(screen.getByLabelText("Texto da pergunta 1"), { target: { value: "Qual a sua queixa principal?" } });
    fireEvent.click(screen.getByRole("button", { name: "Remover pergunta 2" }));
    fireEvent.click(screen.getByRole("button", { name: /Adicionar pergunta/ }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Preencha o texto de todas as perguntas.")).toBeInTheDocument();
    expect(h.save).not.toHaveBeenCalled();
    const last = screen.getAllByLabelText(/Texto da pergunta/).at(-1) as HTMLElement;
    fireEvent.change(last, { target: { value: "Algo mais?" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    const arg = h.save.mock.calls[0][0];
    expect(arg.questions).toHaveLength(DEFAULT_QUESTIONS.length);
    // (lista da clínica)
    expect(arg.questions).toHaveLength(DEFAULT_QUESTIONS.length);
    expect(arg.questions?.[0].label).toBe("Qual a sua queixa principal?");
    expect(arg.questions?.at(-1)?.label).toBe("Algo mais?");
  });
});
