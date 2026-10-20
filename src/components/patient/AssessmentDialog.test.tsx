import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/hooks/useBodyAssessments", () => ({
  useCreateAssessment: () => ({ mutateAsync: h.create, isPending: false }),
  useUpdateAssessment: () => ({ mutateAsync: h.update, isPending: false }),
}));
vi.mock("@/hooks/useCurrentProfessional", () => ({ useCurrentProfessional: () => ({ data: { id: "pr-1" } }) }));
const { AssessmentDialog } = await import("./AssessmentDialog");

const type = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
const save = () => userEvent.click(screen.getByRole("button", { name: /Salvar avaliação/ }));

beforeEach(() => { h.create.mockReset().mockResolvedValue({}); h.update.mockReset().mockResolvedValue(undefined); });

describe("AssessmentDialog — medidas antigas", () => {
  it("sem nenhum dado: avisa e não grava", async () => {
    render(<AssessmentDialog patientId="p1" open onOpenChange={vi.fn()} />);
    await save();
    expect((await screen.findByRole("alert")).textContent).toMatch(/ao menos o peso/);
    expect(h.create).not.toHaveBeenCalled();
  });
  it("data futura é recusada", async () => {
    render(<AssessmentDialog patientId="p1" open onOpenChange={vi.fn()} />);
    type("Data da avaliação", "2999-01-01");
    type("Peso (kg)", "70");
    await save();
    expect((await screen.findByRole("alert")).textContent).toMatch(/futura/);
    expect(h.create).not.toHaveBeenCalled();
  });
  it("avaliação antiga: grava data retroativa, valores e o profissional autor; fecha o diálogo", async () => {
    const onOpenChange = vi.fn();
    render(<AssessmentDialog patientId="p1" open onOpenChange={onOpenChange} />);
    type("Data da avaliação", "2026-03-10");
    type("Peso (kg)", "72,5");
    type("% de gordura", "28,4");
    type("Cintura", "84");
    await save();
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    expect(h.create.mock.calls[0][0]).toEqual({
      assessed_at: "2026-03-10", method: "manual", weight: 72.5, body_fat_pct: 28.4, measurements: { cintura: 84 }, professionalId: "pr-1",
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
  it("edição: envia update com o id e preserva chaves desconhecidas", async () => {
    const a = { id: "a1", patient_id: "p1", professional_id: null, assessed_at: "2026-03-10", method: "bioimpedancia", weight: 80, body_fat_pct: null, measurements: { cintura: 90, extra: "x" }, document_url: null, created_at: "" };
    render(<AssessmentDialog patientId="p1" open onOpenChange={vi.fn()} assessment={a} />);
    expect((screen.getByLabelText("Peso (kg)") as HTMLInputElement).value).toBe("80");
    type("Cintura", "88");
    await save();
    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    expect(h.update.mock.calls[0][0]).toMatchObject({ id: "a1", payload: { weight: 80, measurements: { cintura: 88, extra: "x" } } });
    expect(h.create).not.toHaveBeenCalled();
  });
  it("erro de permissão do servidor aparece traduzido e o diálogo continua aberto", async () => {
    h.create.mockRejectedValue({ code: "42501" });
    const onOpenChange = vi.fn();
    render(<AssessmentDialog patientId="p1" open onOpenChange={onOpenChange} />);
    type("Peso (kg)", "70");
    await save();
    expect((await screen.findByRole("alert")).textContent).toMatch(/não tem permissão/i);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
