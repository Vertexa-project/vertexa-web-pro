import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  perms: { canEditNutrition: true, canEditWorkout: true },
  pending: null as unknown, config: null as unknown,
  generate: vi.fn(), resolve: vi.fn(), generateResult: null as unknown,
}));
vi.mock("@/hooks/useDisciplines", () => ({ useDisciplinePermissions: () => ({ perms: h.perms }) }));
vi.mock("@/hooks/useCurrentProfessional", () => ({ useCurrentProfessional: () => ({ data: { id: "pr1", clinicId: "c1" } }) }));
vi.mock("@/hooks/usePlanDrafts", () => ({
  usePendingPlanDraft: () => ({ data: h.pending }),
  usePlanDraftConfig: () => ({ data: h.config }),
  useGeneratePlanDraft: () => ({ mutate: (v: unknown, o: { onSuccess?: (r: unknown) => void }) => { h.generate(v); o.onSuccess?.(h.generateResult); }, isPending: false }),
  useResolvePlanDraft: () => ({ mutate: h.resolve, isPending: false }),
}));
vi.mock("./NutritionPlanEditor", () => ({ NutritionPlanEditor: (p: { open: boolean; draft?: { id: string; payload: { title: string } } | null; onDraftSaved?: (d: unknown) => void }) => (p.open && p.draft ? <button onClick={() => p.onDraftSaved?.(p.draft)}>editor dieta {p.draft.payload.title}</button> : null) }));
vi.mock("./WorkoutPlanEditor", () => ({ WorkoutPlanEditor: (p: { open: boolean; draft?: { payload: { title: string } } | null }) => (p.open && p.draft ? <p>editor treino {p.draft.payload.title}</p> : null) }));

import { AiFirstDraftSection } from "./AiFirstDraftSection";

const patient = { id: "p1" } as never;
const draft = (kind: "dieta" | "treino") => ({
  id: "d1", kind, patient_type: "emagrecimento", patient_type_label: "Emagrecimento / acima do peso", mode: "demo", status: "pendente", created_at: "2026-11-17T12:00:00Z",
  payload: kind === "dieta" ? { kind, title: "Plano 1.600 kcal", totalKcal: 1600, meals: [{ time: "07:00", name: "Café", items: ["x"], calories: 400, options: [] }] }
    : { kind, title: "Treino A/B/C", goal: "g", workouts: [{ letter: "A", name: "A", primary_muscle_group: "costas", estimated_minutes: 40, exercises: [{ name: "e", muscle_groups: [], sets: 3, reps: 10, load_kg: null, notes: "n", rest_seconds: 60 }] }] },
});

beforeEach(() => {
  h.perms = { canEditNutrition: true, canEditWorkout: true }; h.pending = null; h.config = null; h.generate.mockReset(); h.resolve.mockReset();
  h.generateResult = { mode: "demo", draft: draft("dieta"), has_published_plan: false };
});

describe("AiFirstDraftSection (A8)", () => {
  it("quem não tem a disciplina do plano não vê o botão (dieta: só nutricionista; treino: só educador físico)", () => {
    h.perms = { canEditNutrition: false, canEditWorkout: true };
    const { container, rerender } = render(<AiFirstDraftSection patient={patient} kind="dieta" existing={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AiFirstDraftSection patient={patient} kind="treino" existing={null} />);
    expect(screen.getByRole("button", { name: /Gerar primeira versão \(Vertexa IA\)/ })).toBeInTheDocument();
    h.perms = { canEditNutrition: true, canEditWorkout: false };
    rerender(<AiFirstDraftSection patient={patient} kind="treino" existing={null} />);
    expect(screen.queryByRole("button", { name: /Gerar primeira versão/ })).toBeNull();
  });
  it("escolhe o tipo (lista padrão da reunião), gera e abre o editor com o rascunho", () => {
    render(<AiFirstDraftSection patient={patient} kind="dieta" existing={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Gerar primeira versão \(Vertexa IA\)/ }));
    const select = screen.getByLabelText("Tipo de paciente") as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(expect.arrayContaining(["Emagrecimento / acima do peso", "Hipertrofia / ganho de massa", "Falso magro / recomposição"]));
    fireEvent.change(select, { target: { value: "cardiometabolico" } });
    fireEvent.change(screen.getByLabelText(/Observações para este paciente/), { target: { value: "intolerante a lactose" } });
    fireEvent.click(screen.getByRole("button", { name: "Gerar rascunho" }));
    expect(h.generate).toHaveBeenCalledWith({ patientType: "cardiometabolico", notes: "intolerante a lactose" });
    expect(screen.getByText("editor dieta Plano 1.600 kcal")).toBeInTheDocument();
  });
  it("usa a lista de tipos configurada pela clínica", () => {
    h.config = { patient_types: [{ key: "gestante", label: "Gestante", base: "retomada" }], method_dieta: null, method_treino: null };
    render(<AiFirstDraftSection patient={patient} kind="treino" existing={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Gerar primeira versão/ }));
    expect([...(screen.getByLabelText("Tipo de paciente") as HTMLSelectElement).options].map((o) => o.text)).toEqual(["Gestante"]);
  });
  it("com plano publicado, avisa que o rascunho NÃO substitui até salvar (dieta e treino publicado), mas não para treino em rascunho", () => {
    const { rerender } = render(<AiFirstDraftSection patient={patient} kind="dieta" existing={{ id: "np" } as never} />);
    fireEvent.click(screen.getByRole("button", { name: /Gerar primeira versão/ }));
    expect(screen.getByText(/O rascunho NÃO substitui o publicado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    rerender(<AiFirstDraftSection patient={patient} kind="treino" existing={{ id: "wp", is_draft: false } as never} />);
    fireEvent.click(screen.getByRole("button", { name: /Gerar primeira versão/ }));
    expect(screen.getByText(/O rascunho NÃO substitui o publicado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    rerender(<AiFirstDraftSection patient={patient} kind="treino" existing={{ id: "wp", is_draft: true } as never} />);
    fireEvent.click(screen.getByRole("button", { name: /Gerar primeira versão/ }));
    expect(screen.queryByText(/O rascunho NÃO substitui o publicado/)).toBeNull();
  });
  it("rascunho pendente: selo exato, paciente não vê, Revisar abre o editor, Descartar registra", () => {
    h.pending = draft("dieta");
    render(<AiFirstDraftSection patient={patient} kind="dieta" existing={{ id: "np" } as never} />);
    expect(screen.getByText("Rascunho · gerado pela Vertexa IA (demonstração) · revise antes de publicar")).toBeInTheDocument();
    expect(screen.getByText(/O paciente não vê este rascunho/)).toBeInTheDocument();
    expect(screen.getByText(/NÃO substitui o publicado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revisar rascunho" }));
    fireEvent.click(screen.getByText("editor dieta Plano 1.600 kcal")); // simula salvar no editor
    expect(h.resolve).toHaveBeenCalledWith({ draftId: "d1", decision: "usado" });
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(h.resolve).toHaveBeenCalledWith({ draftId: "d1", decision: "descartado" });
  });
});
