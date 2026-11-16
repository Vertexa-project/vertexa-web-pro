import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  rows: [] as unknown[], loading: false, error: false,
  complete: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), dialog: vi.fn(),
}));
vi.mock("@/hooks/usePatientReminders", () => ({
  usePatientReminders: () => ({ data: h.rows, isLoading: h.loading, isError: h.error, refetch: vi.fn() }),
  useCompleteReminder: () => ({ mutateAsync: h.complete, isPending: false }),
  useDeleteReminder: () => ({ mutateAsync: h.remove, isPending: false }),
}));
vi.mock("./ReminderDialog", () => ({ ReminderDialog: (p: { kind: string; existing: { id: string } | null }) => { h.dialog(p); return <p>dialogo {p.kind} {p.existing?.id ?? "novo"}</p>; } }));

import { RemindersCard } from "./RemindersCard";
import { todayIsoBR } from "@/lib/domain/stockMoves";

const plus = (n: number) => { const d = new Date(`${todayIsoBR()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const row = (o: object) => ({ id: "r1", patient_id: "p", kind: "return", title: null, due_on: plus(10), notify_patient: true, notify_days_before: 7, pro_notify_days_before: 7, message_template: null, done_at: null, ...o });
const view = () => render(<RemindersCard patientId="p" patientName="Mariana Teste" />);

beforeEach(() => { h.rows = []; h.loading = false; h.error = false; h.complete.mockClear(); h.remove.mockClear(); h.dialog.mockClear(); });

describe("Exames e retornos na ficha (A2)", () => {
  it("vazio explica o que acontece ao cadastrar; exame novo abre o diálogo de exame", () => {
    view();
    expect(screen.getByText(/Nenhum retorno ou exame cadastrado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Exame/ }));
    expect(screen.getByText("dialogo exam novo")).toBeInTheDocument();
  });
  it("lista com data pt-BR e quanto falta; atrasado marcado; feito riscado", () => {
    h.rows = [row({ id: "a", due_on: plus(3) }), row({ id: "b", kind: "exam", title: "Hemograma", due_on: plus(-2) }), row({ id: "c", kind: "exam", title: "Ferritina", done_at: "2026-11-10T10:00:00Z" })];
    view();
    expect(screen.getAllByText("Retorno").length).toBeGreaterThan(1); // botão + linha
    expect(screen.getByText("Exame: Hemograma")).toBeInTheDocument();
    expect(screen.getByText("Atrasado")).toBeInTheDocument();
    expect(screen.getByText(/em 3 dias/)).toBeInTheDocument();
    expect(screen.getByText(/há 2 dias/)).toBeInTheDocument();
    expect(screen.getByText("Exame: Ferritina").className).toMatch(/line-through/);
    expect(screen.getAllByText(/\d{2}\/\d{2}\/\d{4}/).length).toBeGreaterThanOrEqual(3);
  });
  it("o botão Retorno edita o retorno aberto (mesma linha), não cria outro", () => {
    h.rows = [row({ id: "a" })];
    view();
    fireEvent.click(screen.getByRole("button", { name: /^Retorno$/ }));
    expect(screen.getByText("dialogo return a")).toBeInTheDocument();
  });
  it("marcar como feito e apagar chamam o banco com o id certo", () => {
    h.rows = [row({ id: "a" })];
    view();
    fireEvent.click(screen.getByRole("button", { name: "Marcar como feito: Retorno" }));
    expect(h.complete).toHaveBeenCalledWith({ id: "a", done: true });
    fireEvent.click(screen.getByRole("button", { name: "Apagar Retorno" }));
    expect(h.remove).toHaveBeenCalledWith("a");
  });
});
