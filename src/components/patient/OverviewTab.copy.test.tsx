import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./ExportPointsButton", () => ({ ExportPointsButton: () => null }));
vi.mock("./PatientTeamSection", () => ({ PatientTeamSection: ({ patientSex }: { patientSex?: string | null }) => <h3>{patientSex === "masculino" ? "TEAM-MASC" : "TEAM-OTHER"}</h3> }));
vi.mock("./RiskSignalsPanel", () => ({ RiskSignalsPanel: () => null }));
vi.mock("./WeeklyNoteCard", () => ({ WeeklyNoteCard: () => null }));
vi.mock("./PreConsultaCard", () => ({ PreConsultaCard: () => <h3>PRE-CONSULTA</h3> })); // tem teste próprio
vi.mock("./RemindersCard", () => ({ RemindersCard: ({ patientName }: { patientName: string }) => <h3>LEMBRETES de {patientName}</h3> })); // tem teste próprio
vi.mock("@/components/routine/PatientRoutineCards", () => ({ RoutineCard: () => null, MissionCard: () => null })); // tem teste próprio (A4+A5)
vi.mock("@/hooks/usePlans", () => ({ useWorkoutPlan: () => ({ data: null, isLoading: false }), useNutritionPlan: () => ({ data: null, isLoading: false }) }));
vi.mock("@/hooks/useBodyAssessments", () => ({ useLatestWeight: () => ({ current: 117 }) }));

import { OverviewTab } from "./OverviewTab";

const base = { id: "p", goal: "Emagrecer", target_weight: 100, sex: "masculino", clinic_id: "c" } as never;
const snap = (streak: number) => ({ streak, weekly_completion_rate: 50, risk_factors: [], positive_factors: [] }) as never;

describe("OverviewTab: textos", () => {
  it("Sequência 0 => 'Sem sequência' e peso usa a fonte única", () => {
    render(<OverviewTab patient={base} snapshot={snap(0)} onGoToTab={() => {}} />);
    expect(screen.getByText("Sem sequência")).toBeInTheDocument();
    expect(screen.queryByText("0 dias")).toBeNull();
    expect(screen.getByText("117 kg → 100 kg")).toBeInTheDocument();
  });
  it("traz o cartão Exames e retornos com o nome do paciente", () => {
    render(<OverviewTab patient={{ ...(base as object), profile: { full_name: "Mariana Teste" } } as never} snapshot={snap(1)} onGoToTab={() => {}} />);
    expect(screen.getByText("LEMBRETES de Mariana Teste")).toBeInTheDocument();
  });
  it("traz o cartão Pré-consulta no Resumo", () => {
    render(<OverviewTab patient={base} snapshot={snap(1)} onGoToTab={() => {}} />);
    expect(screen.getByText("PRE-CONSULTA")).toBeInTheDocument();
  });
  it("1 dia no singular", () => {
    render(<OverviewTab patient={base} snapshot={snap(1)} onGoToTab={() => {}} />);
    expect(screen.getByText("1 dia")).toBeInTheDocument();
  });
  it("passa o sexo para a equipe (neutro p/ homem)", () => {
    render(<OverviewTab patient={base} snapshot={snap(2)} onGoToTab={() => {}} />);
    expect(screen.getByText("TEAM-MASC")).toBeInTheDocument();
  });
});
