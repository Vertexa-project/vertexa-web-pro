import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ mutate: vi.fn(), pending: false }));
vi.mock("@/hooks/usePatientReminders", () => ({ useSaveReminder: () => ({ mutate: h.mutate, isPending: h.pending }) }));

import { ReminderDialog } from "./ReminderDialog";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import type { ReminderRow } from "@/lib/domain/patientReminders";

const plus = (n: number) => {
  const d = new Date(`${todayIsoBR()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const base: ReminderRow = { id: "r1", patient_id: "p1", kind: "return", title: null, due_on: plus(20), notify_patient: true, notify_days_before: 7, pro_notify_days_before: 3, message_template: null, done_at: null };
const open = (kind: "exam" | "return", existing: ReminderRow | null) =>
  render(<ReminderDialog open onOpenChange={() => undefined} patientId="p1" patientName="Mariana Teste" kind={kind} existing={existing} />);

describe("ReminderDialog (A2)", () => {
  it("exame sem nome ou sem data não salva e explica em português", () => {
    h.mutate.mockClear();
    open("exam", null);
    fireEvent.click(screen.getByRole("button", { name: "Salvar lembrete" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Informe o nome do exame.");
    fireEvent.change(screen.getByLabelText("Exame"), { target: { value: "Hemograma" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar lembrete" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Informe a data.");
    expect(h.mutate).not.toHaveBeenCalled();
  });
  it("cadastra exame com o texto padrão (vai vazio: o padrão acompanha a clínica), prévia com a data pt-BR", () => {
    h.mutate.mockClear();
    open("exam", null);
    fireEvent.change(screen.getByLabelText("Exame"), { target: { value: "Hemograma" } });
    fireEvent.change(screen.getByLabelText("Fazer até"), { target: { value: plus(5) } });
    expect(screen.getByText(/Olá, Mariana! Lembrete: o exame Hemograma deve ser feito até \d{2}\/\d{2}\/\d{4} \(em 5 dias\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar lembrete" }));
    expect(h.mutate.mock.calls[0][0]).toMatchObject({ patientId: "p1", id: null, kind: "exam", title: "Hemograma", dueOn: plus(5), noticeDays: 7, message: "", notifyPatient: true });
  });
  it("mudar a data de um retorno existente manda o MESMO id (muda a linha, não cria outra) e a mensagem editada", () => {
    h.mutate.mockClear();
    open("return", { ...base, message_template: "Oi {nome}, retorno em {data}" });
    expect(screen.getByLabelText("Mensagem para o paciente")).toHaveValue("Oi {nome}, retorno em {data}");
    fireEvent.change(screen.getByLabelText("Data do retorno"), { target: { value: plus(40) } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar lembrete" }));
    expect(h.mutate.mock.calls[0][0]).toMatchObject({ id: "r1", kind: "return", dueOn: plus(40), proNoticeDays: 3, message: "Oi {nome}, retorno em {data}" });
    expect(screen.getByRole("button", { name: "Voltar ao texto padrão" })).toBeInTheDocument();
  });
  it("sem aviso ao paciente some a escolha da mensagem e o lembrete segue para a equipe", () => {
    h.mutate.mockClear();
    open("return", base);
    fireEvent.click(screen.getByLabelText("Avisar o paciente pelo app"));
    expect(screen.queryByLabelText("Mensagem para o paciente")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar lembrete" }));
    expect(h.mutate.mock.calls[0][0]).toMatchObject({ id: "r1", notifyPatient: false });
  });
  it("sem acesso clínico o banco recusa e a tela explica", () => {
    h.mutate.mockClear();
    h.mutate.mockImplementation((_i: unknown, o: { onError: (e: unknown) => void }) => o.onError({ code: "42501", message: "forbidden: clinical access required" }));
    open("return", base);
    fireEvent.click(screen.getByRole("button", { name: "Salvar lembrete" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Só quem acompanha o paciente cadastra lembretes.");
    h.mutate.mockReset();
  });
});
