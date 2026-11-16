import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const patients = vi.hoisted(() => ({
  list: [] as unknown[],
}));
vi.mock("@/hooks/usePatients", () => ({ useListPatients: () => ({ data: patients.list, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/useCurrentProfessional", () => ({ useCurrentProfessional: () => ({ data: null }), useCurrentProfessionalName: () => ({ data: "Dra. Ana" }) }));
vi.mock("@/components/dashboard/AgendaCard", () => ({ AgendaCard: () => null }));
vi.mock("@/components/dashboard/AdherenceChart", () => ({ AdherenceChart: () => null }));

import { DashboardPage } from "./DashboardPage";

const mk = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `p${i}`, goal: null, current_weight: null, start_date: null, birth_date: null,
  profile: { full_name: `Paciente ${i}`, email: null, avatar_url: null, avatar_path: null },
  snapshot: null, professionals: [], lastActivityAt: null, lastWeightAt: null, lastPhotoAt: null, lastWorkoutAt: null, ...extra,
});

describe("Dashboard: KPIs e Foco do dia", () => {
  it("sem snapshot: KPI Em atenção bate com a lista; sem 'Sem dados'; ações por motivo", () => {
    const old = new Date(Date.now() - 12 * 86400000).toISOString();
    patients.list = [mk(1), mk(2), mk(3, { lastWeightAt: old, lastActivityAt: old })];
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    const atencao = screen.getByText("Em atenção").closest("div")!.parentElement!;
    expect(atencao.textContent).toContain("3");
    expect(screen.queryByText(/sem dados$/i)).toBeNull();
    expect(screen.getAllByText("Ainda não registrou no app").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Chamar no app" }).length).toBe(2);
    expect(screen.getByRole("button", { name: "Enviar lembrete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tratar" })).toBeNull();
  });
});
