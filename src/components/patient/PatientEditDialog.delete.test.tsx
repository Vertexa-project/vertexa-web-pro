import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PatientDetail } from "@/types/db";

vi.mock("@/hooks/usePatients", () => ({
  usePatientRegistrationAccess: () => ({
    data: { hasLoginAccount: false, loginEmailMatchesRegistration: null },
    isLoading: false,
    isError: false,
  }),
  useUpdatePatientRegistration: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

const section = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("@/components/patient/PatientDeleteSection", () => ({
  PatientDeleteSection: (props: { onDeleted: () => void }) => {
    section.props = props;
    return <button onClick={props.onDeleted}>stub excluir</button>;
  },
}));

const { PatientEditDialog } = await import("./PatientEditDialog");

const patient = {
  id: "pat-1",
  clinic_id: "c-1",
  profile: { id: "pf-1", full_name: "Maria Silva", email: "maria@x.com", auth_user_id: null },
  professionals: [],
} as unknown as PatientDetail;

describe("PatientEditDialog — zona de exclusão (WP-PATIENT-DIAG-DELETE-01)", () => {
  it("sem onDeleted, nenhuma ação destrutiva é montada", () => {
    section.props = null;
    render(<PatientEditDialog patient={patient} open onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "stub excluir" })).not.toBeInTheDocument();
    expect(section.props).toBeNull();
  });

  it("com onDeleted: monta a seção para o paciente certo; após excluir fecha o diálogo e avisa a página", async () => {
    const onOpenChange = vi.fn();
    const onDeleted = vi.fn();
    render(<PatientEditDialog patient={patient} open onOpenChange={onOpenChange} onDeleted={onDeleted} />);
    expect(section.props).toMatchObject({ patientId: "pat-1", patientName: "Maria Silva", enabled: true });

    await userEvent.click(screen.getByRole("button", { name: "stub excluir" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });
});
