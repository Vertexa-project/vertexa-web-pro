import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  eligibility: { data: undefined as unknown, isLoading: false, isError: false },
  eligibilityArgs: [] as unknown[],
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null as unknown,
  reset: vi.fn(),
}));

vi.mock("@/hooks/usePatients", () => ({
  usePatientDeletionEligibility: (...args: unknown[]) => {
    state.eligibilityArgs = args;
    return state.eligibility;
  },
  useDeleteUnusedPatientRegistration: () => ({
    mutate: state.mutate,
    isPending: state.isPending,
    isError: state.isError,
    error: state.error,
    reset: state.reset,
  }),
}));

const { PatientDeleteSection } = await import("./PatientDeleteSection");

const eligible = { data: { eligible: true, reason: "PATIENT_DELETE_ELIGIBLE" }, isLoading: false, isError: false };
const blocked = (reason: string) => ({ data: { eligible: false, reason }, isLoading: false, isError: false });

function renderSection(onDeleted = vi.fn()) {
  render(<PatientDeleteSection patientId="pat-1" patientName="Maria Silva" enabled onDeleted={onDeleted} />);
  return { onDeleted };
}

beforeEach(() => {
  state.eligibility = eligible;
  state.mutate.mockReset();
  state.reset.mockReset();
  state.isPending = false;
  state.isError = false;
  state.error = null;
});

describe("PatientDeleteSection (WP-PATIENT-DIAG-DELETE-01)", () => {
  it("consulta a elegibilidade do paciente certo, só quando habilitada", () => {
    renderSection();
    expect(state.eligibilityArgs).toEqual(["pat-1", true]);
    expect(
      screen.getByText("Disponível apenas para cadastros que ainda não possuem acesso ou movimentação na plataforma."),
    ).toBeInTheDocument();
  });

  it("elegível: abre a confirmação; o botão final fica desabilitado até digitar EXCLUIR", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: "Excluir cadastro" }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/remove definitivamente este cadastro não utilizado/i)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Excluir definitivamente" });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText(/para confirmar/i), "excluir");
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByLabelText(/para confirmar/i));
    await user.type(screen.getByLabelText(/para confirmar/i), "EXCLUIR");
    expect(confirm).toBeEnabled();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("confirmado: chama a mutação com o id do paciente e avisa o pai no sucesso", async () => {
    const user = userEvent.setup();
    state.mutate.mockImplementation((_id: string, opts: { onSuccess?: () => void }) => opts.onSuccess?.());
    const { onDeleted } = renderSection();
    await user.click(screen.getByRole("button", { name: "Excluir cadastro" }));
    await user.type(screen.getByLabelText(/para confirmar/i), "EXCLUIR");
    await user.click(screen.getByRole("button", { name: "Excluir definitivamente" }));

    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate.mock.calls[0][0]).toBe("pat-1");
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("cancelar não exclui", async () => {
    const user = userEvent.setup();
    const { onDeleted } = renderSection();
    await user.click(screen.getByRole("button", { name: "Excluir cadastro" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(state.mutate).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("paciente com conta de acesso: botão desabilitado e explica o motivo", () => {
    state.eligibility = blocked("PATIENT_DELETE_AUTH_LINKED");
    renderSection();
    expect(screen.getByRole("button", { name: "Excluir cadastro" })).toBeDisabled();
    expect(screen.getByText("Este paciente já possui uma conta de acesso vinculada.")).toBeInTheDocument();
  });

  it("paciente com movimentação: botão desabilitado e explica o motivo", () => {
    state.eligibility = blocked("PATIENT_DELETE_HAS_PLANS");
    renderSection();
    expect(screen.getByRole("button", { name: "Excluir cadastro" })).toBeDisabled();
    expect(
      screen.getByText("Este paciente já possui movimentações na plataforma e não pode ser excluído."),
    ).toBeInTheDocument();
  });

  it("carregando ou erro: fail-closed", () => {
    state.eligibility = { data: undefined, isLoading: true, isError: false };
    const { unmount } = render(
      <PatientDeleteSection patientId="pat-1" patientName="Maria" enabled onDeleted={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /verificando/i })).toBeDisabled();
    unmount();

    state.eligibility = { data: undefined, isLoading: false, isError: true };
    renderSection();
    expect(screen.getByRole("button", { name: "Excluir cadastro" })).toBeDisabled();
  });

  it("erro do servidor na exclusão aparece em linguagem humana e o diálogo continua aberto", async () => {
    const user = userEvent.setup();
    state.isError = true;
    state.error = { hint: "PATIENT_DELETE_HAS_MESSAGES" };
    renderSection();
    await user.click(screen.getByRole("button", { name: "Excluir cadastro" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Este paciente já possui movimentações na plataforma e não pode ser excluído.",
    );
  });
});
