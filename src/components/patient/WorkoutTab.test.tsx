import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const plan = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/hooks/usePlans", () => ({ useWorkoutPlan: () => ({ data: plan.data, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/useExerciseLibrary", () => ({ useExerciseLibrary: () => ({ index: new Map(), items: [] }) }));
vi.mock("@/hooks/useDisciplines", () => ({ useDisciplinePermissions: () => ({ perms: { canEditWorkout: true } }) }));
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
});
