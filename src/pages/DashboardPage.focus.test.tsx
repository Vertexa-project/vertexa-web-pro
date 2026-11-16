import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const patients = vi.hoisted(() => ({
  list: [] as unknown[],
}));
vi.mock("@/hooks/useFin", () => ({ useFinContext: () => ({ clinicId: "c1", access: { isAdmin: true, roles: [], can: {} }, isLoading: false }) }));
vi.mock("@/hooks/usePatients", () => ({ useListPatients: () => ({ data: patients.list, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/useCurrentProfessional", () => ({ useCurrentProfessional: () => ({ data: null }), useCurrentProfessionalName: () => ({ data: "Dra. Ana" }) }));
vi.mock("@/components/dashboard/TodayAgenda", () => ({ TodayAgenda: () => null }));
vi.mock("@/hooks/usePatientReminders", () => ({ useOpenReminders: () => ({ data: [], isLoading: false, isError: false }) }));
vi.mock("@/components/dashboard/AdherenceChart", () => ({ AdherenceChart: () => null }));

import { DashboardPage } from "./DashboardPage";

const mk = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `p${i}`, goal: null, current_weight: null, start_date: null, birth_date: null,
  profile: { full_name: `Paciente ${i}`, email: null, avatar_url: null, avatar_path: null },
  snapshot: null, professionals: [], lastActivityAt: null, lastWeightAt: null, lastPhotoAt: null, lastWorkoutAt: null, ...extra,
});

const cardOf = (title: string) => screen.getByText(title).closest('[class*="rounded"]') as HTMLElement;

describe("Dashboard: KPIs e Foco do dia", () => {
  it("sem snapshot: KPI Em atenção bate com a lista; sem 'Sem dados'; ações por motivo", () => {
    const old = new Date(Date.now() - 12 * 86400000).toISOString();
    patients.list = [mk(1), mk(2), mk(3, { lastWeightAt: old, lastActivityAt: old })];
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    const atencao = screen.getByText("Em atenção").closest("div")!.parentElement!;
    expect(atencao.textContent).toContain("3");
    expect(screen.queryByText(/sem dados$/i)).toBeNull();
    expect(screen.getAllByText("Ainda não registrou no app").length).toBeGreaterThan(0);
    // 2 pacientes nunca registrados × 3 listas (Foco, Para reativar, Pendências)
    expect(screen.getAllByRole("button", { name: /^Chamar no app/ }).length).toBe(6);
    expect(screen.getAllByRole("button", { name: /^Enviar lembrete/ })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Tratar" })).toBeNull();
  });

  it("A: nome sem truncar, etiqueta e botão em linhas próprias (sem sobreposição)", () => {
    const old = new Date(Date.now() - 25 * 86400000).toISOString();
    patients.list = [mk(1, { profile: { full_name: "Camila", email: null, avatar_url: null, avatar_path: null }, lastWeightAt: old, lastPhotoAt: old, lastWorkoutAt: old, lastActivityAt: old })];
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    const focus = cardOf("Foco do dia");
    const name = within(focus).getByText("Camila");
    expect(name.className).not.toMatch(/truncate/);
    const badge = within(focus).getByText(/Sem registro há 25 dias/);
    expect(badge.className).toMatch(/whitespace-normal/);
    const btn = within(focus).getByRole("button", { name: /^Enviar lembrete/ });
    expect(btn.className).toMatch(/max-w-full/);
    // botão e etiqueta nunca são irmãos na mesma linha flex
    expect(badge.parentElement).not.toBe(btn.parentElement);
    expect(badge.parentElement!.className).toMatch(/flex-wrap/);
  });

  it("B: Para reativar e Pendências usam a ação por motivo; nenhum 'Tratar'", () => {
    const old = new Date(Date.now() - 12 * 86400000).toISOString();
    patients.list = [mk(1), mk(3, { lastWeightAt: old, lastActivityAt: old })];
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    const reativar = cardOf("Para reativar");
    const pend = cardOf("Pendências de registro");
    for (const card of [reativar, pend]) {
      expect(within(card).getByRole("button", { name: /^Chamar no app: Paciente 1/ })).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: /^Enviar lembrete: Paciente 3/ })).toBeInTheDocument();
    }
    expect(screen.queryAllByRole("button", { name: /tratar/i })).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/Tratar/);
  });
});
