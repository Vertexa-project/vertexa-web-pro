import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  data: undefined as unknown, canEditMed: true, canEditNutri: false, remove: vi.fn(async () => undefined), end: vi.fn(async () => undefined), dialog: vi.fn(),
}));
vi.mock("@/hooks/useMedication", () => ({
  useMedication: () => ({ data: h.data, isLoading: false, isError: false, refetch: vi.fn() }),
  useMedMutations: () => ({ remove: { mutateAsync: h.remove, isPending: false }, end: { mutateAsync: h.end, isPending: false } }),
}));
vi.mock("@/hooks/useDisciplines", () => ({ useDisciplinePermissions: () => ({ perms: { canEditMedications: h.canEditMed, canEditNutrition: h.canEditNutri } }) }));
vi.mock("./MedicationDialogs", () => {
  const D = (name: string) => (p: { treatment?: { id: string } }) => { h.dialog(name); return <p>dialogo {name} {p.treatment?.id ?? ""}</p>; };
  return { TreatmentDialog: D("tratamento"), DoseDialog: D("dose"), ApplicationDialog: D("aplicacao"), DeliveryDialog: D("entrega") };
});

import { MedicationCard } from "./MedicationCard";

const t = { id: "t1", patient_id: "p", medication: "Tirzepatida", started_on: "2026-11-03", dose_mg: 5, weekday: 5, applied_where: "home", notes: "Tomar de manhã", stock_item_id: null, stock_unit_id: null, status: "active", ended_on: null };
const full = () => ({
  treatments: [t],
  states: { t1: { state: "overdue", due_on: "2026-11-20", days_late: 2 } },
  doses: [{ id: "d2", treatment_id: "t1", dose_mg: 5, effective_on: "2026-11-17", note: "Subiu" }, { id: "d1", treatment_id: "t1", dose_mg: 2.5, effective_on: "2026-11-03", note: "Dose inicial" }],
  applications: [
    { id: "a1", treatment_id: "t1", applied_on: "2026-11-13", dose_mg: 2.5, place: "clinic", source: "professional", applied_by_name: "Dra. Juliana", note: null, stock_item_id: "i1" },
    { id: "a2", treatment_id: "t1", applied_on: "2026-11-06", dose_mg: 2.5, place: "home", source: "patient", applied_by_name: "Mariana", note: null, stock_item_id: null },
  ],
  deliveries: [{ id: "e1", treatment_id: "t1", delivered_on: "2026-11-10", quantity: 2, note: null, stock_item_id: null }],
});
const view = () => render(<MedicationCard patientId="p" />);
beforeEach(() => { h.data = full(); h.canEditMed = true; h.canEditNutri = false; h.remove.mockClear(); h.end.mockClear(); });

describe("Cartão Medicação na ficha (A3)", () => {
  it("mostra tratamento, dose, dia, local, atraso e as 3 listas em pt-BR", () => {
    view();
    expect(screen.getByText("Tirzepatida · 5 mg")).toBeInTheDocument();
    expect(screen.getByText(/Sexta · Em casa · desde 03\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByText("Aplicação atrasada · 2 dias")).toBeInTheDocument();
    expect(screen.getByText("Histórico de doses")).toBeInTheDocument();
    expect(screen.getByText("2,5 mg")).toBeInTheDocument();
    expect(screen.getByText(/desde 17\/11\/2026 · Subiu/)).toBeInTheDocument();
    expect(screen.getByText(/Na clínica · por Dra. Juliana · baixa no estoque/)).toBeInTheDocument();
    expect(screen.getByText(/Em casa · registrada pelo paciente/)).toBeInTheDocument();
    expect(screen.getByText(/2 canetas\/doses/)).toBeInTheDocument();
  });
  it("sem rolagem lateral: lista, sem <table>", () => {
    const { container } = view();
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelectorAll("ul").length).toBe(3);
  });
  it("médico edita: botões e dialogos certos", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Registrar aplicação" }));
    expect(screen.getByText("dialogo aplicacao t1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ajustar dose" }));
    expect(screen.getByText("dialogo dose t1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrega" }));
    expect(screen.getByText("dialogo entrega t1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Novo tratamento" }));
    expect(screen.getByText("dialogo tratamento")).toBeInTheDocument();
  });
  it("apagar lançamento e encerrar chamam a ação", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Apagar aplicação de 13/11/2026" }));
    expect(h.remove).toHaveBeenCalledWith({ kind: "application", id: "a1" });
    fireEvent.click(screen.getByRole("button", { name: "Apagar entrega de 10/11/2026" }));
    expect(h.remove).toHaveBeenCalledWith({ kind: "delivery", id: "e1" });
    fireEvent.click(screen.getByRole("button", { name: "Encerrar" }));
    expect(h.end).toHaveBeenCalledWith("t1");
  });
  it("quem não é médico/nutricionista LÊ mas não vê nenhum botão de editar", () => {
    h.canEditMed = false; h.canEditNutri = false;
    view();
    expect(screen.getByText("Tirzepatida · 5 mg")).toBeInTheDocument();
    for (const n of ["Novo tratamento", "Registrar aplicação", "Registrar entrega", "Ajustar dose", "Encerrar"]) expect(screen.queryByRole("button", { name: n })).toBeNull();
    expect(screen.queryByRole("button", { name: /Apagar/ })).toBeNull();
  });
  it("nutricionista também edita", () => {
    h.canEditMed = false; h.canEditNutri = true;
    view();
    expect(screen.getByRole("button", { name: "Registrar aplicação" })).toBeInTheDocument();
  });
  it("vazio: explica e, sem permissão, diz quem cadastra", () => {
    h.data = { treatments: [], states: {}, doses: [], applications: [], deliveries: [] };
    view();
    expect(screen.getByText(/Nenhum tratamento cadastrado\. Cadastre/)).toBeInTheDocument();
    h.canEditMed = false;
    view();
    expect(screen.getByText(/Só médico ou nutricionista/)).toBeInTheDocument();
  });
  it("mais de 5 lançamentos: mostra 5 e oferece ver todos", () => {
    const d = full();
    d.applications = Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, treatment_id: "t1", applied_on: `2026-10-${String(10 + i)}`, dose_mg: 2.5, place: "home", source: "patient", applied_by_name: "M", note: null, stock_item_id: null }));
    h.data = d;
    view();
    expect(screen.getAllByText(/registrada pelo paciente/).length).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: "Ver todos (8)" }));
    expect(screen.getAllByText(/registrada pelo paciente/).length).toBe(8);
  });
});
