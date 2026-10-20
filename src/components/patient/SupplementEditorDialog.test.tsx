import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), perms: { canEditSupplements: true, canEditMedications: false } }));
vi.mock("@/hooks/useSupplements", () => ({
  useCreateSupplement: () => ({ mutate: h.create, isPending: false }),
  useUpdateSupplement: () => ({ mutate: h.update, isPending: false }),
}));
vi.mock("@/hooks/useDisciplines", () => ({ useDisciplinePermissions: () => ({ perms: h.perms }) }));
vi.mock("@/lib/observability/sentry", () => ({ captureException: vi.fn() }));
const { SupplementEditorDialog } = await import("./SupplementEditorDialog");

const type = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
const open = (props: Partial<Parameters<typeof SupplementEditorDialog>[0]> = {}) =>
  render(<SupplementEditorDialog patientId="p1" existing={null} kind="supplement" open onOpenChange={vi.fn()} {...props} />);

beforeEach(() => {
  h.create.mockReset();
  h.update.mockReset();
  h.perms.canEditSupplements = true;
  h.perms.canEditMedications = false;
});

describe("SupplementEditorDialog", () => {
  it("suplemento novo: oferece a lista pronta; medicamento não tem lista", () => {
    open();
    expect(screen.getByLabelText("Escolher da lista (opcional)")).toBeTruthy();
  });
  it("medicamento novo: sem lista pronta", () => {
    h.perms.canEditMedications = true;
    open({ kind: "medication" });
    expect(screen.queryByLabelText("Escolher da lista (opcional)")).toBeNull();
    expect(screen.getByRole("heading", { name: /Novo medicamento/ })).toBeTruthy();
  });
  it("cria suplemento com marca, observação e lembrete normalizado", async () => {
    open();
    type("Nome", "Creatina");
    type("Dose", "5 g");
    type("Marca indicada", "Marca X");
    type("Lembrete às", "18:30");
    type("Observação para o paciente", "com água");
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0]).toMatchObject({ patientId: "p1", kind: "supplement", name: "Creatina", dose: "5 g", brand: "Marca X", notes: "com água", reminderTime: "18:30:00" });
  });
  it("sem nome: avisa e não cria", async () => {
    open();
    await userEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/nome do suplemento/);
    expect(h.create).not.toHaveBeenCalled();
  });
  it("sem permissão de medicamento (ex.: nutricionista): salvar desabilitado e motivo visível", () => {
    h.perms.canEditMedications = false;
    open({ kind: "medication" });
    expect((screen.getByRole("button", { name: "Adicionar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("note").textContent).toMatch(/Médico/);
  });
  it("edição de medicamento envia kind só para o guard e preenche os campos atuais", async () => {
    h.perms.canEditMedications = true;
    const m = { id: "m1", patient_id: "p1", name: "Losartana", dose: "50 mg", time_label: "Manhã", order_index: 0, created_at: "", kind: "medication" as const, brand: "Genérico", notes: null, reminder_time: "08:00:00" };
    open({ existing: m, kind: "supplement" });
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Losartana");
    expect((screen.getByLabelText("Lembrete às") as HTMLInputElement).value).toBe("08:00");
    type("Dose", "100 mg");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(h.update.mock.calls[0][0]).toMatchObject({ id: "m1", kind: "medication", dose: "100 mg", brand: "Genérico", reminderTime: "08:00:00" });
    expect(h.create).not.toHaveBeenCalled();
  });
});
