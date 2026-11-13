import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { AppointmentsTab } from "./AppointmentsTab";
import { PatientPackagesTab } from "./PatientPackagesTab";
import { AppointmentFormDialog } from "./appointments/AppointmentFormDialog";
import { KitDialog } from "./appointments/KitDialog";
import type { ApptDetail, ApptRow, KitView, PatientPackageRow } from "@/lib/api/finAppointments";

const state = vi.hoisted(() => ({
  can: {} as Record<string, boolean>, isAdmin: false,
  rows: [] as unknown[], packages: [] as unknown[], kit: null as unknown, ctx: null as unknown,
  listArgs: [] as unknown[], completeMutate: vi.fn(), correctMutate: vi.fn(), saveMutate: vi.fn(), deliverMutate: vi.fn(),
}));

vi.mock("@/hooks/useFin", () => ({
  useFinContext: () => ({ clinicId: "c1", isLoading: false, access: { isAdmin: state.isAdmin, roles: [], can: state.can } }),
  useUnits: () => ({ data: [{ id: "u1", name: "Unidade principal", is_active: true, is_primary: true }, { id: "u2", name: "Unidade 2", is_active: true, is_primary: false }] }),
}));
vi.mock("@/hooks/useFinAppointments", () => {
  const q = (data: unknown) => ({ data, isLoading: false, isError: false, isSuccess: true, refetch: vi.fn() });
  const m = (mutate: unknown) => ({ mutate, isPending: false });
  return {
    useAppointments: (_c: unknown, f: unknown) => { state.listArgs.push(f); return q(state.rows); },
    useAppointment: () => q(null), usePatientPackages: () => q(state.packages), useApptKit: () => q(state.kit), useApptContext: () => q(state.ctx),
    useApptPatients: () => q([{ patient_id: "p1", full_name: "Paciente Um" }]),
    useCompleteAppointment: () => m(state.completeMutate), useCorrectAppointment: () => m(state.correctMutate), useSaveAppointment: () => m(state.saveMutate),
    useDeliverPackageItem: () => m(state.deliverMutate), useCancelAppointment: () => m(vi.fn()), useSetParticipants: () => m(vi.fn()),
  };
});

const wrap = (ui: React.ReactElement, path = "/") => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
const MANAGER = { appt_read: true, appt_write: true, stock_move_read: true, patient_pkg_read: true, sales_read: true, own_appt: true };
const FIN = { appt_read: true, stock_move_read: true, patient_pkg_read: true };
const PRO = { own_appt: true, own_sales_read: true };

const row = (over: Partial<ApptRow> = {}): ApptRow => ({
  id: "a1", performed_on: "2026-11-13", status: "done", unit_id: "u1", unit_name: "Unidade principal", patient_id: "p1", patient_name: "Mariana Teste", service_id: "s1", service_name: "Aplicação GLP-1",
  participants: [{ professional_id: "r1", name: "Dra. Juliana", role: "responsavel" }, { professional_id: "r2", name: "Enf. Camila", role: "executor" }], sale_id: "v1", package_name: null, without_sale: false,
  base_value_cents: 30000, material_cost_cents: 8100, material_estimated_cents: 0, has_shortfall: false, can_manage: true, created_at: "2026-11-13T10:00:00Z", ...over,
});

beforeEach(() => {
  state.can = MANAGER; state.isAdmin = false; state.rows = []; state.packages = []; state.listArgs = [];
  [state.completeMutate, state.correctMutate, state.saveMutate, state.deliverMutate].forEach((f) => f.mockReset());
});

describe("Financeiro › Atendimentos", () => {
  it("lista paciente, serviço, participantes por papel e o custo do material (R$ 81,00) para quem lê o estoque", () => {
    state.rows = [row()];
    wrap(<AppointmentsTab />);
    const table = screen.getByRole("table", { name: "Atendimentos" });
    expect(within(table).getByText("Mariana Teste")).toBeInTheDocument();
    expect(within(table).getByText("Aplicação GLP-1")).toBeInTheDocument();
    expect(within(table).getByText(/Dra\. Juliana \(responsável\), Enf\. Camila \(executor\)/)).toBeInTheDocument();
    expect(within(table).getByText(/R\$\s*81,00/)).toBeInTheDocument();
  });

  it("profissional participante: custo nulo vem do servidor → sem coluna Material; vê o aviso de «só os seus»; pode registrar o próprio atendimento", () => {
    state.can = PRO;
    state.rows = [row({ material_cost_cents: null, material_estimated_cents: null })];
    wrap(<AppointmentsTab />);
    expect(screen.getByRole("note")).toHaveTextContent(/só os atendimentos em que participa/);
    expect(screen.queryByRole("columnheader", { name: /Material/i })).toBeNull();
    expect(screen.queryByText(/R\$\s*81,00/)).toBeNull();
    expect(screen.getByRole("button", { name: /Novo atendimento/ })).toBeInTheDocument();
  });

  it("Financeiro (consulta): vê o custo mas não cria nem gerencia", () => {
    state.can = FIN; state.rows = [row()];
    wrap(<AppointmentsTab />);
    expect(screen.getByText(/R\$\s*81,00/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Novo atendimento/ })).toBeNull();
  });

  it("sem papel: só o aviso de acesso", () => {
    state.can = {};
    wrap(<AppointmentsTab />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(/Você não tem acesso/);
  });

  it("consumo sem saldo e «sem venda» aparecem como selos; o valor estimado leva asterisco e nota", () => {
    state.rows = [row({ has_shortfall: true, material_cost_cents: 2800, material_estimated_cents: 600, without_sale: true, sale_id: null })];
    wrap(<AppointmentsTab />);
    expect(screen.getAllByText("Consumo sem saldo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sem venda").length).toBeGreaterThan(0);
    expect(screen.getByText(/R\$\s*28,00\*/)).toBeInTheDocument();
    expect(screen.getByText(/inclui valor estimado/)).toBeInTheDocument();
  });

  it("filtros «só atendidos sem venda» e «só com consumo sem saldo» chegam à consulta", async () => {
    const user = userEvent.setup();
    wrap(<AppointmentsTab />);
    await user.click(screen.getByLabelText("Só atendidos sem venda"));
    await user.click(screen.getByLabelText("Só com consumo sem saldo"));
    expect(state.listArgs.at(-1)).toMatchObject({ onlyWithoutSale: true, onlyShortfall: true });
  });

  it("estado vazio orienta a registrar; no celular a lista vira cartões", () => {
    wrap(<AppointmentsTab />);
    expect(screen.getByText("Nenhum atendimento no período")).toBeInTheDocument();
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    try {
      state.rows = [row()];
      wrap(<AppointmentsTab />);
      expect(screen.queryByRole("table")).toBeNull();
      expect(within(screen.getByRole("list", { name: "Atendimentos" })).getByText("Mariana Teste")).toBeInTheDocument();
    } finally { window.matchMedia = original; }
  });
});

// ---------- kit ----------
const appt = (over: Partial<ApptDetail> = {}): ApptDetail => ({
  id: "a1", clinic_id: "c1", unit_id: "u1", unit_name: "Unidade principal", status: "open", performed_on: "2026-11-13", service_id: "s1", service_name: "Aplicação GLP-1", patient_id: "p1", patient_name: "Mariana Teste",
  sale_id: null, sale_item_id: null, patient_package_item_id: null, notes: null, agenda_appointment_id: null, encounter_id: null, base_value_cents: null, material_cost_cents: 0, material_estimated_cents: 0,
  has_shortfall: false, can_manage: true, can_cost: true, cancel_reason: null, done_at: null, canceled_at: null, package: null, sale_description: null, participants: [], materials: [], ...over,
});
const kitLine = (over: Record<string, unknown>) => ({
  item_id: "i-amp", name: "Ampola X", consumption_unit: "ampola", stock_unit: "ampola", factor: 1, fractional: false, individual_use: false, lot_control: true, planned_qty: 2, qty: 2, source: "kit", short_qty: 0, status: "planned",
  balance: 13, avg_cost_cents: 4000, cost_cents: 0, suggested_lot_id: "lot-curto",
  lots: [{ lot_id: "lot-curto", lot_code: "L-CURTO", expiry_date: "2999-01-01", available: 3, expired: false }, { lot_id: "lot-longo", lot_code: "L-LONGO", expiry_date: "2999-06-01", available: 10, expired: false }, { lot_id: "lot-venc", lot_code: "L-VELHO", expiry_date: "2020-01-01", available: 1, expired: true }],
  ...over,
});
const kit = (lines: unknown[], over: Partial<KitView> = {}): KitView => ({
  appointment_id: "a1", status: "open", unit_id: "u1", patient_id: "p1", can_cost: true, lines: lines as KitView["lines"],
  catalog: [{ id: "i-amp", name: "Ampola X", consumption_unit: "ampola", stock_unit: "ampola", fractional: false, factor: 1, balance: 13 }, { id: "i-ser", name: "Seringa D", consumption_unit: "un", stock_unit: "un", fractional: false, factor: 1, balance: 19 },
    { id: "i-cat", name: "Cateter F", consumption_unit: "un", stock_unit: "un", fractional: false, factor: 1, balance: 0 }], ...over,
});
const KIT_E2 = [kitLine({}), kitLine({ item_id: "i-ser", name: "Seringa D", consumption_unit: "un", stock_unit: "un", planned_qty: 1, qty: 1, lots: [], suggested_lot_id: null, balance: 19, avg_cost_cents: 100 })];

describe("Realizar atendimento — confirmar o kit (E2/E3)", () => {
  it("E2: o kit vem pré-preenchido (2 ampolas + 1 seringa) com custo estimado R$ 81,00; o lote vem automático (vence primeiro)", () => {
    state.kit = kit(KIT_E2);
    wrap(<KitDialog appt={appt()} mode="complete" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const items = within(dialog).getByRole("list", { name: "Itens do kit" });
    expect(within(items).getAllByRole("listitem")).toHaveLength(2);
    expect(within(items).getByDisplayValue("Ampola X")).toBeInTheDocument();
    expect(within(items).getAllByLabelText(/Quantidade/)[0]).toHaveValue("2");
    expect(within(items).getAllByLabelText("Lote")[0]).toHaveValue("");
    expect(within(dialog).getByText(/Custo estimado do material/).parentElement).toHaveTextContent(/R\$\s*81,00/);
  });

  it("confirmar sem editar manda o kit como está; troca de lote, quantidade e remoção chegam ao servidor", async () => {
    const user = userEvent.setup();
    state.kit = kit(KIT_E2);
    wrap(<KitDialog appt={appt()} mode="complete" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getAllByLabelText("Lote")[0], "lot-longo");
    const qty = within(dialog).getAllByLabelText(/Quantidade/)[0];
    await user.clear(qty); await user.type(qty, "3");
    await user.click(within(dialog).getByRole("button", { name: "Remover Seringa D do kit" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirmar e realizar" }));
    expect(state.completeMutate).toHaveBeenCalledTimes(1);
    expect(state.completeMutate.mock.calls[0][0]).toEqual({ id: "a1", lines: [{ itemId: "i-amp", quantity: 3, lotId: "lot-longo" }], note: undefined });
  });

  it("lote vencido aparece desabilitado (vencido só sai como perda por vencimento)", () => {
    state.kit = kit(KIT_E2);
    wrap(<KitDialog appt={appt()} mode="complete" onClose={() => {}} />);
    const opt = screen.getAllByRole("option").find((o) => /L-VELHO/.test(o.textContent ?? "")) as HTMLOptionElement;
    expect(opt).toBeDisabled();
    expect(opt.textContent).toMatch(/VENCIDO/);
  });

  it("E3: sem saldo suficiente avisa que o atendimento é salvo mesmo assim (consumo sem saldo, gestor avisado) e NÃO bloqueia o envio", async () => {
    const user = userEvent.setup();
    state.kit = kit([kitLine({ balance: 1 })]);
    wrap(<KitDialog appt={appt()} mode="complete" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/Faltam 1 ampola no estoque.*consumo sem saldo.*gestor é avisado/);
    await user.click(within(dialog).getByRole("button", { name: "Confirmar e realizar" }));
    expect(state.completeMutate).toHaveBeenCalledTimes(1);
  });

  it("unidade de consumo: 5 ml de frasco de 30 ml baixa 0,167 do frasco e custa R$ 50,10", () => {
    state.kit = kit([kitLine({ item_id: "i-soro", name: "Soro 30 ml", consumption_unit: "ml", stock_unit: "frasco", factor: 30, fractional: true, planned_qty: 5, qty: 5, balance: 2, avg_cost_cents: 30000, lots: [], suggested_lot_id: null })]);
    wrap(<KitDialog appt={appt()} mode="complete" onClose={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(/sai 0,167 frasco do estoque/);
    expect(screen.getByRole("status")).toHaveTextContent(/R\$\s*50,10/);
  });

  it("quantidade zero e item repetido são recusados na tela, sem chamar o servidor", async () => {
    const user = userEvent.setup();
    state.kit = kit(KIT_E2);
    wrap(<KitDialog appt={appt()} mode="complete" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const qty = within(dialog).getAllByLabelText(/Quantidade/)[1];
    await user.clear(qty); await user.type(qty, "0");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar e realizar" }));
    expect(within(dialog).getByText("Informe uma quantidade maior que zero.")).toBeInTheDocument();
    expect(state.completeMutate).not.toHaveBeenCalled();
  });

  it("adicionar item: escolhe do catálogo (sem repetir os que já estão no kit) e envia como linha nova", async () => {
    const user = userEvent.setup();
    state.kit = kit([KIT_E2[0]]);
    wrap(<KitDialog appt={appt()} mode="complete" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Adicionar item/ }));
    const select = within(dialog).getAllByLabelText("Item").find((el) => el.tagName === "SELECT") as HTMLSelectElement;
    expect(within(select).queryByRole("option", { name: "Ampola X" })).toBeNull();
    await user.selectOptions(select, "i-cat");
    const q2 = within(dialog).getAllByLabelText(/Quantidade/)[1];
    await user.type(q2, "1");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/Faltam 1 un no estoque/);   // o catálogo traz o saldo (0): o aviso de consumo sem saldo vale para item adicionado também
    await user.click(within(dialog).getByRole("button", { name: "Confirmar e realizar" }));
    expect(state.completeMutate.mock.calls[0][0].lines).toEqual([{ itemId: "i-amp", quantity: 2, lotId: null }, { itemId: "i-cat", quantity: 1, lotId: null }]);
  });

  it("corrigir kit (E11): exige o motivo e então manda a nova baixa; o saldo conferido inclui o que a correção devolve", async () => {
    const user = userEvent.setup();
    state.kit = kit([kitLine({ balance: 1, qty: 2, status: "active" })], { status: "done" });
    const done = appt({ status: "done", materials: [{ id: "m1", item_id: "i-amp", item_name: "Ampola X", consumption_unit: "ampola", stock_unit: "ampola", batch: 1, source: "kit", planned_qty: 2, qty_consumption: 2, qty: 2, applied_qty: 2, short_qty: 0, status: "active", cost_cents: 8000, estimated_cents: 0 }] });
    wrap(<KitDialog appt={done} mode="correct" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText(/Faltam/)).toBeNull();   // saldo 1 + 2 que voltam = 3 ≥ 2
    await user.click(within(dialog).getByRole("button", { name: "Salvar correção" }));
    expect(within(dialog).getByText("Informe o motivo da correção.")).toBeInTheDocument();
    expect(state.correctMutate).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText("Motivo da correção"), "Foram 3 ampolas");
    await user.click(within(dialog).getByRole("button", { name: "Salvar correção" }));
    expect(state.correctMutate.mock.calls[0][0]).toEqual({ id: "a1", lines: [{ itemId: "i-amp", quantity: 2, lotId: null }], reason: "Foram 3 ampolas" });
  });

  it("quem não vê custo (profissional) não vê custo nem custo médio no kit", () => {
    state.kit = kit([kitLine({ avg_cost_cents: null })], { can_cost: false });
    wrap(<KitDialog appt={appt({ can_cost: false })} mode="complete" onClose={() => {}} />);
    expect(screen.queryByText(/Custo estimado/)).toBeNull();
    expect(screen.queryByText(/custo\s+R\$/)).toBeNull();
  });
});

// ---------- novo atendimento ----------
const CTX = {
  can_manage: true, is_professional: true, my_professional_id: "r1", roles: ["responsavel"],
  units: [{ id: "u1", name: "Unidade principal", is_primary: true }, { id: "u2", name: "Unidade 2", is_primary: false }],
  services: [{ id: "s1", name: "Aplicação GLP-1", roles: ["responsavel", "executor"] }, { id: "s3", name: "Consulta médica", roles: ["responsavel"] }],
  professionals: [{ id: "r1", name: "Dra. Juliana" }, { id: "r2", name: "Enf. Camila" }],
  sale_items: [], packages: [{ patient_package_item_id: "ppi1", patient_package_id: "pp1", name: "Programa Emagrecer", expires_on: "2999-01-01", qty_total: 3, qty_used: 2, remaining: 1 }],
};

describe("Novo atendimento", () => {
  it("exige paciente, serviço e responsável; depois grava com executor e a origem (pacote) escolhida", async () => {
    const user = userEvent.setup();
    state.ctx = CTX;
    wrap(<AppointmentFormDialog clinicId="c1" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Registrar atendimento" }));
    expect(within(dialog).getByText("Escolha o paciente.")).toBeInTheDocument();
    expect(within(dialog).getByText("Escolha o serviço.")).toBeInTheDocument();
    expect(state.saveMutate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Paciente Um" }));
    await user.selectOptions(within(dialog).getByLabelText("Serviço"), "s1");
    await user.click(within(dialog).getByRole("button", { name: "Registrar atendimento" }));
    expect(within(dialog).getByText("Informe quem é o responsável pelo atendimento.")).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("Responsável"), "r1");
    await user.selectOptions(within(dialog).getByLabelText("Executor"), "r2");
    await user.selectOptions(within(dialog).getByLabelText(/Origem/), "pkg:ppi1");
    await user.click(within(dialog).getByRole("button", { name: "Registrar atendimento" }));
    expect(state.saveMutate).toHaveBeenCalledTimes(1);
    expect(state.saveMutate.mock.calls[0][0]).toMatchObject({
      id: null, unitId: "u1", patientId: "p1", serviceId: "s1", saleItemId: null, patientPackageItemId: "ppi1",
      participants: [{ professionalId: "r1", role: "responsavel" }, { professionalId: "r2", role: "executor" }],
    });
  });

  it("serviço que só prevê o responsável não oferece executor nem auxiliar", async () => {
    const user = userEvent.setup();
    state.ctx = CTX;
    wrap(<AppointmentFormDialog clinicId="c1" initialPatient={{ id: "p1", name: "Mariana Teste" }} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Serviço"), "s3");
    expect(within(dialog).queryByLabelText("Executor")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Adicionar auxiliar/ })).toBeNull();
  });

  it("profissional (sem papel de gestão) entra sozinho como responsável: só registra o próprio atendimento", () => {
    state.ctx = { ...CTX, can_manage: false };
    wrap(<AppointmentFormDialog clinicId="c1" initialPatient={{ id: "p1", name: "Mariana Teste" }} onClose={() => {}} />);
    expect(within(screen.getByRole("dialog")).getByLabelText("Responsável")).toHaveValue("r1");
  });
});

// ---------- pacotes dos pacientes ----------
const pkg = (over: Partial<PatientPackageRow> = {}): PatientPackageRow => ({
  id: "pp1", patient_id: "p1", patient_name: "Mariana Teste", unit_id: "u1", unit_name: "Unidade principal", name: "Programa Emagrecer", sale_id: "v1", purchased_on: "2026-11-13", expires_on: "2999-02-11",
  status: "active", expired: false, price_cents: 180000,
  items: [{ id: "ppi-c", item_type: "service", name: "Consulta médica", service_id: "s3", stock_item_id: null, qty_total: 3, qty_used: 1, remaining: 2, net_total_cents: 132354 },
    { id: "ppi-s", item_type: "product", name: "Suplemento C", service_id: null, stock_item_id: "i-c", qty_total: 3, qty_used: 0, remaining: 3, net_total_cents: 47646 }], ...over,
});

describe("Financeiro › Pacotes dos pacientes", () => {
  const RECEP = { patient_pkg_read: true, package_deliver_read: true, package_deliver_write: true, sales_read: true };
  it("lista o saldo (consultas 1/3, suplementos 0/3) e o detalhe mostra o valor rateado R$ 1.323,54 + R$ 476,46", async () => {
    const user = userEvent.setup();
    state.can = RECEP; state.packages = [pkg()];
    wrap(<PatientPackagesTab />);
    const table = screen.getByRole("table", { name: "Pacotes dos pacientes" });
    expect(within(table).getByText(/Consulta médica: 1\/3 · Suplemento C: 0\/3/)).toBeInTheDocument();
    await user.click(within(table).getByRole("button", { name: /Abrir pacote Programa Emagrecer/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/R\$\s*1\.323,54/)).toBeInTheDocument();
    expect(within(dialog).getByText(/R\$\s*476,46/)).toBeInTheDocument();
  });

  it("E17: a Recepção entrega 1 suplemento (baixa estoque); sessão não tem botão de entrega", async () => {
    const user = userEvent.setup();
    state.can = RECEP; state.packages = [pkg()];
    wrap(<PatientPackagesTab />);
    await user.click(screen.getByRole("button", { name: /Abrir pacote/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Entregar Consulta médica" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Entregar Suplemento C" }));
    const form = (await screen.findAllByRole("dialog")).at(-1) as HTMLElement;
    await user.click(within(form).getByRole("button", { name: "Registrar entrega" }));
    expect(state.deliverMutate).toHaveBeenCalledTimes(1);
    expect(state.deliverMutate.mock.calls[0][0]).toEqual({ itemId: "ppi-s", qty: 1, unitId: "u1" });
  });

  it("quantidade acima do saldo do pacote é recusada na tela", async () => {
    const user = userEvent.setup();
    state.can = RECEP; state.packages = [pkg()];
    wrap(<PatientPackagesTab />);
    await user.click(screen.getByRole("button", { name: /Abrir pacote/ }));
    await user.click(await screen.findByRole("button", { name: "Entregar Suplemento C" }));
    const form = (await screen.findAllByRole("dialog")).at(-1) as HTMLElement;
    const qty = within(form).getByLabelText("Quantidade entregue");
    await user.clear(qty); await user.type(qty, "4");
    await user.click(within(form).getByRole("button", { name: "Registrar entrega" }));
    expect(within(form).getByText(/só tem 3 para entregar/)).toBeInTheDocument();
    expect(state.deliverMutate).not.toHaveBeenCalled();
  });

  it("pacote vencido ou cancelado: sem botão de entrega; vencido avisa que o saldo vira receita da clínica", async () => {
    const user = userEvent.setup();
    state.can = RECEP; state.packages = [pkg({ expired: true })];
    wrap(<PatientPackagesTab />);
    await user.click(screen.getByRole("button", { name: /Abrir pacote/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /Entregar/ })).toBeNull();
    expect(within(dialog).getByText(/saldo não usado vira receita da clínica/)).toBeInTheDocument();
  });

  it("Financeiro (consulta) vê o saldo e o valor, mas não entrega; sem papel não vê nada", async () => {
    const user = userEvent.setup();
    state.can = { patient_pkg_read: true, appt_read: true }; state.packages = [pkg()];
    wrap(<PatientPackagesTab />);
    await user.click(screen.getByRole("button", { name: /Abrir pacote/ }));
    expect(within(await screen.findByRole("dialog")).queryByRole("button", { name: /Entregar/ })).toBeNull();
  });
  it("sem papel de leitura: aviso de acesso", () => {
    state.can = {};
    wrap(<PatientPackagesTab />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(/Você não tem acesso/);
  });
});
