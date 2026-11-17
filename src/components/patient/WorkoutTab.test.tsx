import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const plan = vi.hoisted(() => ({ data: null as unknown, canEdit: true }));
vi.mock("./AiFirstDraftSection", () => ({ AiFirstDraftSection: () => null })); // A8: tem teste próprio
vi.mock("./docimport/DocImportSection", () => ({ DocImportSection: () => null })); // importação com Conferência tem teste próprio
vi.mock("@/hooks/usePlans", () => ({ useWorkoutPlan: () => ({ data: plan.data, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/useExerciseLibrary", () => ({ useExerciseLibrary: () => ({ index: new Map(), items: [] }) }));
vi.mock("@/hooks/useDisciplines", () => ({ useDisciplinePermissions: () => ({ perms: { canEditWorkout: plan.canEdit, canEditNutrition: false } }) }));
vi.mock("@/hooks/useCurrentProfessional", () => ({ useCurrentProfessional: () => ({ data: { id: "pr1" } }), useCurrentProfessionalName: () => ({ data: "Dr. Edu" }) }));
vi.mock("./PublishWorkoutDialog", () => ({ PublishWorkoutDialog: (p: { open: boolean; summary: { days: number; exercises: number; withAnimation: number } }) => (p.open ? <p>dialogo publicar {p.summary.days} dias {p.summary.exercises} exercícios</p> : null) }));
vi.mock("./SendToPatientDialog", () => ({ SendToPatientDialog: (p: { open: boolean; kind: string }) => (p.open ? <p>dialogo enviar {p.kind}</p> : null) }));
vi.mock("./WorkoutPlanEditor", () => ({ WorkoutPlanEditor: () => null }));
vi.mock("@/components/exercise/ExerciseMedia", () => ({ ExerciseMedia: () => null }));
vi.mock("@/lib/domain/exerciseLibrary", () => ({ findLibraryExercise: () => null }));

import { WorkoutTab } from "./WorkoutTab";

const ex = (id: string, extra: object = {}) => ({ id, workout_id: "w", name: `Ex ${id}`, muscle_groups: null, sets: 4, reps: 10, load_kg: null, rest_seconds: null, gif_url: null, notes: null, order_index: 1, ...extra });

describe("WorkoutTab", () => {
  it("reps negativo vira — e colunas Carga/Grupos somem quando vazias", () => {
    plan.data = { id: "pl", title: "Plano", goal: null, workouts: [{ id: "w", workout_plan_id: "pl", letter: "A", name: "Treino A", primary_muscle_group: null, day_index: 0, estimated_minutes: null, workout_exercises: [ex("1", { reps: -35 }), ex("2")] }] };
    render(<WorkoutTab patient={{ id: "p" } as never} />);
    expect(screen.queryByText("4 × -35")).toBeNull();
    expect(screen.getByText("4 × —")).toBeInTheDocument();
    expect(screen.getByText("4 × 10")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Carga" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Grupos" })).toBeNull();
  });
  it("mostra Carga quando alguma linha tem", () => {
    plan.data = { id: "pl", title: "Plano", goal: null, workouts: [{ id: "w", workout_plan_id: "pl", letter: "A", name: "Treino A", primary_muscle_group: null, day_index: 0, estimated_minutes: null, workout_exercises: [ex("1", { load_kg: 20 })] }] };
    render(<WorkoutTab patient={{ id: "p" } as never} />);
    expect(screen.getByRole("columnheader", { name: "Carga" })).toBeInTheDocument();
    expect(screen.getByText("20 kg")).toBeInTheDocument();
  });
  it("grupo muscular do treino em português, carga com vírgula (D57)", () => {
    plan.data = { id: "pl", title: "Plano", goal: null, workouts: [{ id: "w", workout_plan_id: "pl", letter: "A", name: "Treino A", primary_muscle_group: "abs", day_index: 0, estimated_minutes: 40, workout_exercises: [ex("1", { load_kg: 22.5 })] }] };
    render(<WorkoutTab patient={{ id: "p" } as never} />);
    expect(screen.getByText(/Abdômen · 40 min/)).toBeInTheDocument();
    expect(screen.queryByText(/\babs\b/)).toBeNull();
    expect(screen.getByText("22,5 kg")).toBeInTheDocument();
  });

  describe("publicar treino (redesign P6)", () => {
    const mk = (extra: object) => ({ id: "pl", title: "Ficha de teste", goal: null, workouts: [{ id: "w", workout_plan_id: "pl", letter: "A", name: "Treino A", primary_muscle_group: null, day_index: 1, estimated_minutes: null, workout_exercises: [ex("1", { notes: "Desça devagar" })] }], ...extra });
    it("rascunho: etiqueta, aviso e Publicar treino (sem Enviar); o clique abre o resumo com dias e exercícios", () => {
      plan.canEdit = true;
      plan.data = mk({ is_draft: true });
      render(<WorkoutTab patient={{ id: "p", profile: { full_name: "Mariana Teste" } } as never} />);
      expect(screen.getByText("Rascunho · nada foi publicado")).toBeInTheDocument();
      expect(screen.getByText(/O paciente ainda não vê este treino/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Enviar ao paciente/ })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Publicar treino/ }));
      expect(screen.getByText("dialogo publicar 1 dias 1 exercícios")).toBeInTheDocument();
    });
    it("publicado (inclusive plano antigo sem a marca): Ativo no app, todos os dias liberados e Enviar ao paciente; instrução do exercício aparece", () => {
      plan.canEdit = true;
      plan.data = mk({ published_at: "2026-11-17T01:30:00Z" });
      render(<WorkoutTab patient={{ id: "p", profile: { full_name: "Mariana Teste" } } as never} />);
      expect(screen.getByText("Ativo no app")).toBeInTheDocument();
      expect(screen.getByText(/Todos os dias liberados no app · publicado em 16\/11\/2026/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Publicar treino/ })).toBeNull();
      expect(screen.getByText("Desça devagar")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Enviar ao paciente/ }));
      expect(screen.getByText("dialogo enviar treino")).toBeInTheDocument();
    });
    it("sem a disciplina de treino: Publicar fica bloqueado com o motivo e não abre nada", () => {
      plan.canEdit = false;
      plan.data = mk({ is_draft: true });
      render(<WorkoutTab patient={{ id: "p", profile: { full_name: "Mariana Teste" } } as never} />);
      const b = screen.getByRole("button", { name: /Publicar treino/ });
      expect(b).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(b);
      expect(screen.queryByText(/dialogo publicar/)).toBeNull();
      expect(screen.getAllByText("Requer a disciplina Educador Físico ou Fisioterapeuta.").length).toBeGreaterThan(0);
      plan.canEdit = true;
    });
  });
});
