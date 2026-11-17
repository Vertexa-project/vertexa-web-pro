import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const m = vi.hoisted(() => ({ nutri: vi.fn(), work: vi.fn() }));
vi.mock("@/hooks/usePlanMutations", () => ({
  useSaveNutritionPlan: () => ({ mutate: (i: unknown, o: { onSuccess?: () => void }) => { m.nutri(i); o.onSuccess?.(); }, isPending: false }),
  useSaveWorkoutPlan: () => ({ mutate: (i: unknown, o: { onSuccess?: () => void }) => { m.work(i); o.onSuccess?.(); }, isPending: false }),
}));
vi.mock("@/hooks/useDisciplines", () => ({ useDisciplinePermissions: () => ({ perms: { canEditNutrition: true, canEditWorkout: true } }) }));
vi.mock("@/hooks/useExerciseLibrary", () => ({ useExerciseLibrary: () => ({ index: new Map(), items: [] }) }));
vi.mock("@/lib/observability/sentry", () => ({ captureException: vi.fn() }));
vi.mock("@/components/exercise/ExerciseMedia", () => ({ ExerciseMedia: () => null }));
vi.mock("@/components/exercise/ExerciseNameInput", () => ({ ExerciseNameInput: (p: { value: string }) => <input aria-label="Nome do exercício" value={p.value} readOnly /> }));

import { NutritionPlanEditor } from "./NutritionPlanEditor";
import { WorkoutPlanEditor } from "./WorkoutPlanEditor";
import type { AiPlanDraft } from "@/lib/domain/planDraft";

const patient = { id: "p1", professionals: [{ id: "pr1" }] } as never;
const SEAL = "Rascunho · gerado pela Vertexa IA (demonstração) · revise antes de publicar";
const dieta: AiPlanDraft = { id: "d1", kind: "dieta", patient_type: "emagrecimento", patient_type_label: "Emagrecimento", mode: "demo", status: "pendente", created_at: "x",
  payload: { kind: "dieta", title: "Plano alimentar 1.600 kcal · Emagrecimento", totalKcal: 1600, basis: ["Peso 82 kg"], warnings: ["Sem prontuário/anamnese finalizado"], guidance: ["Beba água"],
    meals: [{ time: "07:00", name: "Café da manhã", items: ["2 ovos", "Mamão"], calories: 400, options: [{ items: ["Iogurte"], calories: 380 }] }] } };
const treino: AiPlanDraft = { id: "d2", kind: "treino", patient_type: "emagrecimento", patient_type_label: "Emagrecimento", mode: "demo", status: "pendente", created_at: "x",
  payload: { kind: "treino", title: "Treino A/B/C · Emagrecimento", goal: "Emagrecimento", basis: ["Modelo-base"], warnings: [], guidance: [],
    workouts: [{ letter: "A", name: "Inferiores", primary_muscle_group: "quadriceps", estimated_minutes: 45, exercises: [{ name: "Agachamento goblet", muscle_groups: ["quadriceps"], sets: 3, reps: 12, load_kg: null, notes: "Desça devagar.", rest_seconds: 60 }] }] } };

beforeEach(() => { m.nutri.mockClear(); m.work.mockClear(); });

describe("editores com rascunho da Vertexa IA (A8)", () => {
  it("dieta: pré-preenche, mostra o selo, 'Publicar plano' salva e avisa o rascunho; sem rascunho nada muda", () => {
    const saved = vi.fn();
    const { rerender } = render(<NutritionPlanEditor patient={patient} existing={null} open onOpenChange={() => {}} draft={dieta} onDraftSaved={saved} />);
    expect(screen.getByText(SEAL)).toBeInTheDocument();
    expect(screen.getByLabelText("Itens da refeição")).toHaveValue("2 ovos\nMamão");
    expect(screen.getByLabelText("Itens da opção 2")).toHaveValue("Iogurte");
    expect(screen.getByText("Sem prontuário/anamnese finalizado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publicar plano" }));
    expect(m.nutri).toHaveBeenCalledTimes(1);
    expect(m.nutri.mock.calls[0][0]).toMatchObject({ patientId: "p1", title: "Plano alimentar 1.600 kcal · Emagrecimento", meals: [{ time: "07:00", name: "Café da manhã", items: ["2 ovos", "Mamão"], calories: 400 }] });
    expect(saved).toHaveBeenCalledWith(dieta);
    rerender(<NutritionPlanEditor patient={patient} existing={null} open onOpenChange={() => {}} />);
    expect(screen.queryByText(SEAL)).toBeNull();
    expect(screen.getByRole("button", { name: "Salvar plano" })).toBeInTheDocument();
  });
  it("dieta com plano ativo avisa que não substitui até publicar", () => {
    render(<NutritionPlanEditor patient={patient} existing={{ id: "np", title: "Atual", meals: [] } as never} open onOpenChange={() => {}} draft={dieta} />);
    expect(screen.getByText(/NÃO substitui o publicado/)).toBeInTheDocument();
  });
  it("treino: pré-preenche com instrução e intervalo; sem treino publicado salva como rascunho; com publicado diz que substitui", () => {
    const saved = vi.fn();
    const { rerender } = render(<WorkoutPlanEditor patient={patient} existing={null} open onOpenChange={() => {}} draft={treino} onDraftSaved={saved} />);
    expect(screen.getByText(SEAL)).toBeInTheDocument();
    expect(screen.getByLabelText("Instrução do exercício")).toHaveValue("Desça devagar.");
    expect(screen.getByLabelText("Intervalo em segundos")).toHaveValue(60);
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho do treino" }));
    expect(m.work.mock.calls[0][0]).toMatchObject({ patientId: "p1", title: "Treino A/B/C · Emagrecimento", workouts: [{ letter: "A", exercises: [{ name: "Agachamento goblet", sets: 3, reps: 12, rest_seconds: 60, notes: "Desça devagar." }] }] });
    expect(saved).toHaveBeenCalledWith(treino);
    rerender(<WorkoutPlanEditor patient={patient} existing={{ id: "wp", title: "Atual", is_draft: false, workouts: [] } as never} open onOpenChange={() => {}} draft={treino} />);
    expect(screen.getByRole("button", { name: "Salvar e substituir o publicado" })).toBeInTheDocument();
    expect(screen.getByText(/NÃO substitui o publicado/)).toBeInTheDocument();
  });
});
