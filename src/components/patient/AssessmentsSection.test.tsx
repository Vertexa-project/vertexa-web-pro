import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ data: [] as unknown[], del: vi.fn() }));
vi.mock("@/hooks/useBodyAssessments", () => ({
  useBodyAssessments: () => ({ data: h.data }),
  useDeleteAssessment: () => ({ mutateAsync: h.del, isPending: false }),
  useCreateAssessment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAssessment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useCurrentProfessional", () => ({ useCurrentProfessional: () => ({ data: { id: "pr-1" } }) }));
const { AssessmentsSection } = await import("./AssessmentsSection");

const A = (id: string, day: string, o: Record<string, unknown> = {}) => ({ id, patient_id: "p1", professional_id: null, assessed_at: day, method: "manual", weight: 70, body_fat_pct: null, measurements: null, document_url: null, created_at: "", ...o });
beforeEach(() => { h.data = []; h.del.mockReset().mockResolvedValue(undefined); });

describe("AssessmentsSection", () => {
  it("vazio: explica e oferece Adicionar avaliação", () => {
    render(<AssessmentsSection patientId="p1" />);
    expect(screen.getByText(/Nenhuma avaliação lançada/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Adicionar avaliação/ })).toBeTruthy();
  });
  it("lista da mais recente para a mais antiga e ignora avaliação sem nenhum dado (só documento)", () => {
    h.data = [A("a", "2026-01-10"), A("b", "2026-05-10", { weight: 65 }), A("doc", "2026-06-01", { weight: null, measurements: null })];
    render(<AssessmentsSection patientId="p1" />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(/65/)).toBeTruthy(); // mais recente primeiro
  });
  it("mostra circunferências preenchidas", () => {
    h.data = [A("a", "2026-01-10", { measurements: { cintura: 84, braco: 31 } })];
    render(<AssessmentsSection patientId="p1" />);
    expect(screen.getByText(/Cintura 84 · Braço 31/)).toBeTruthy();
  });
  it("excluir pede confirmação e só exclui ao confirmar", async () => {
    h.data = [A("a", "2026-01-10")];
    render(<AssessmentsSection patientId="p1" />);
    await userEvent.click(screen.getByRole("button", { name: /Excluir avaliação/ }));
    expect(h.del).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith("a"));
  });
  it("falha ao excluir mostra o erro", async () => {
    h.data = [A("a", "2026-01-10")];
    h.del.mockRejectedValue({ code: "42501" });
    render(<AssessmentsSection patientId="p1" />);
    await userEvent.click(screen.getByRole("button", { name: /Excluir avaliação/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/não tem permissão/i);
  });
});
