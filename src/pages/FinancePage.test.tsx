import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getFinanceOverview: vi.fn(), getFinanceCharges: vi.fn(), getFinancePatients: vi.fn(), generateMonthCharges: vi.fn(),
  setPatientBilling: vi.fn(), markChargePaid: vi.fn(), reopenCharge: vi.fn(), cancelCharge: vi.fn(), admin: true,
}));
vi.mock("@/lib/api/finance", () => api);
vi.mock("@/hooks/useClinicBrand", () => ({ useClinicBrand: () => ({ data: { clinicId: "c1", name: "Clínica" } }) }));
vi.mock("@/hooks/useIsClinicAdmin", () => ({ useIsClinicAdmin: () => ({ isClinicAdmin: api.admin, isLoading: false }) }));
const { FinancePage } = await import("./FinancePage");

const OV = {
  month: "2026-10", expected_cents: 55000, received_cents: 20000, pending_cents: 5000, overdue_cents: 30000, overdue_count: 1,
  charges_count: 3, at_risk_patients: 2, at_risk_cents: 45000, billed_patients: 3, unconfigured_patients: 1, ticket_avg_cents: 18333, tenure_avg_months: 4,
  projection: [{ month: "2026-11", expected_cents: 55000 }, { month: "2026-12", expected_cents: 55000 }, { month: "2027-01", expected_cents: 27500 }],
};
const CH = (id: string, name: string, status: string, o: Record<string, unknown> = {}) => ({ charge_id: id, patient_id: "p" + id, full_name: name, due_on: "2026-10-05", amount_cents: 20000, status, paid_on: null, overdue: false, ...o });
const CHARGES = [CH("1", "Ana", "paid", { paid_on: "2026-10-03" }), CH("2", "Bia", "pending", { overdue: true, amount_cents: 30000 }), CH("3", "Caio", "pending", { due_on: "2026-10-28", amount_cents: 5000 }), CH("4", "Duda", "canceled")];
const PATS = [{ patient_id: "p1", full_name: "Ana", monthly_amount_cents: 20000, due_day: 5, is_active: true, idle_days: 0 }, { patient_id: "p9", full_name: "Zeca", monthly_amount_cents: null, due_day: null, is_active: null, idle_days: 3 }];
const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FinancePage /></QueryClientProvider>);
const money = (s: string) => s.replace(/\s/g, " ");

beforeEach(() => {
  vi.useRealTimers();
  Object.values(api).forEach((f) => typeof f === "function" && (f as ReturnType<typeof vi.fn>).mockReset?.());
  api.admin = true;
  api.getFinanceOverview.mockResolvedValue(OV);
  api.getFinanceCharges.mockResolvedValue(CHARGES);
  api.getFinancePatients.mockResolvedValue(PATS);
  api.generateMonthCharges.mockResolvedValue(0);
  api.setPatientBilling.mockResolvedValue(undefined);
  api.markChargePaid.mockResolvedValue(undefined);
  api.reopenCharge.mockResolvedValue(undefined);
  api.cancelCharge.mockResolvedValue(undefined);
});

describe("FinancePage", () => {
  it("não-admin vê aviso e nenhuma consulta financeira é feita", async () => {
    api.admin = false;
    renderPage();
    expect((await screen.findByRole("note")).textContent).toMatch(/administrador/);
    expect(api.getFinanceOverview).not.toHaveBeenCalled();
    expect(api.generateMonthCharges).not.toHaveBeenCalled();
  });
  it("mostra os totais em reais e gera as cobranças do mês uma vez", async () => {
    renderPage();
    await screen.findByText("Previsto no mês");
    const cards = document.body.textContent ?? "";
    expect(money(cards)).toContain("R$ 550,00");
    expect(money(cards)).toContain("R$ 200,00");
    expect(money(cards)).toContain("R$ 300,00");
    expect(screen.getByText("Em atraso (1)")).toBeTruthy();
    expect(screen.getByText("Receita em risco (2)")).toBeTruthy();
    await waitFor(() => expect(api.generateMonthCharges).toHaveBeenCalledTimes(1));
    expect(api.generateMonthCharges.mock.calls[0].length).toBe(2);
  });
  it("lista cobranças com a situação certa e as ações por situação", async () => {
    renderPage();
    const sec = await screen.findByRole("region", { name: "Cobranças do mês" });
    await within(sec).findByText("Pago em 03/10");
    expect(within(sec).getByText("Em atraso")).toBeTruthy();
    expect(within(sec).getByText("A vencer")).toBeTruthy();
    expect(within(sec).getByRole("button", { name: "Reabrir cobrança de Ana" })).toBeTruthy();
    expect(within(sec).queryByRole("button", { name: "Marcar Ana como pago" })).toBeNull();
    expect(within(sec).getByRole("button", { name: "Marcar Bia como pago" })).toBeTruthy();
    expect(within(sec).getByText("Cancelada")).toBeTruthy();
    expect(within(sec).queryByRole("button", { name: "Marcar Duda como pago" })).toBeNull();
    expect(within(sec).getByRole("button", { name: "Reabrir cobrança de Duda" })).toBeTruthy();
  });
  it("marcar pago, cancelar e reabrir chamam a API certa", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Marcar Bia como pago" }));
    await waitFor(() => expect(api.markChargePaid).toHaveBeenCalled());
    expect(api.markChargePaid.mock.calls[0][0]).toBe("2");
    await userEvent.click(screen.getByRole("button", { name: "Cancelar cobrança de Caio" }));
    await waitFor(() => expect(api.cancelCharge).toHaveBeenCalled());
    expect(api.cancelCharge.mock.calls[0][0]).toBe("3");
    await userEvent.click(screen.getByRole("button", { name: "Reabrir cobrança de Ana" }));
    await waitFor(() => expect(api.reopenCharge).toHaveBeenCalled());
    expect(api.reopenCharge.mock.calls[0][0]).toBe("1");
  });
  it("definir valor: valida, converte para centavos e salva", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Definir valor de Zeca" }));
    fireEvent.change(screen.getByLabelText("Valor mensal (R$)"), { target: { value: "abc" } });
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/valor válido/);
    expect(api.setPatientBilling).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Valor mensal (R$)"), { target: { value: "1.250,50" } });
    fireEvent.change(screen.getByLabelText("Dia do vencimento (1 a 28)"), { target: { value: "29" } });
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/1 a 28/);
    fireEvent.change(screen.getByLabelText("Dia do vencimento (1 a 28)"), { target: { value: "15" } });
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(api.setPatientBilling).toHaveBeenCalled());
    expect(api.setPatientBilling.mock.calls[0][0]).toEqual({ patientId: "p9", amountCents: 125050, dueDay: 15, active: true });
  });
  it("editar valor existente já vem preenchido", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Editar valor de Ana" }));
    expect((screen.getByLabelText("Valor mensal (R$)") as HTMLInputElement).value).toBe("200,00");
    expect((screen.getByLabelText("Dia do vencimento (1 a 28)") as HTMLInputElement).value).toBe("5");
  });
  it("navegar de mês consulta o mês novo; o limite do servidor desabilita o botão", async () => {
    renderPage();
    await screen.findByText("Previsto no mês");
    await userEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    await waitFor(() => expect(api.getFinanceOverview.mock.calls.some((c) => (c[1] as string) < (api.getFinanceOverview.mock.calls[0][1] as string))).toBe(true));
    const next = screen.getByRole("button", { name: "Próximo mês" });
    await userEvent.click(next);
    await userEvent.click(next);
    expect((screen.getByRole("button", { name: "Próximo mês" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("barras da projeção têm altura real e proporcional", async () => {
    renderPage();
    await screen.findByText("Previsto no mês");
    const h = screen.getAllByTestId("proj-bar").map((b) => (b as HTMLElement).style.height);
    expect(h).toEqual(["80px", "80px", "40px"]);
  });
});
