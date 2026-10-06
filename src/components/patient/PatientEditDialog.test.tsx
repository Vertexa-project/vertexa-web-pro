import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PatientDetail } from "@/types/db";

const state = vi.hoisted(() => ({
  access: { data: undefined as unknown, isLoading: false, isError: false },
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null as unknown,
  reset: vi.fn(),
}));

vi.mock("@/hooks/usePatients", () => ({
  usePatientRegistrationAccess: () => state.access,
  useUpdatePatientRegistration: () => ({
    mutate: state.mutate,
    isPending: state.isPending,
    isError: state.isError,
    error: state.error,
    reset: state.reset,
  }),
}));

const { PatientEditDialog } = await import("./PatientEditDialog");

function patient(over: Record<string, unknown> = {}): PatientDetail {
  return {
    id: "pat-1",
    profile_id: "pf-1",
    clinic_id: "c-1",
    birth_date: "1990-01-02",
    sex: "feminino",
    height_cm: 168,
    goal: "Emagrecer",
    start_date: "2026-01-10",
    start_weight: 72,
    current_weight: 70,
    target_weight: 66,
    profile: { id: "pf-1", full_name: "Maria Silva", email: "maria@gmail.co", auth_user_id: null },
    professionals: [],
    ...over,
  } as unknown as PatientDetail;
}

const noAccount = { data: { hasLoginAccount: false, loginEmailMatchesRegistration: null }, isLoading: false, isError: false };
const linked = { data: { hasLoginAccount: true, loginEmailMatchesRegistration: true }, isLoading: false, isError: false };
const drift = { data: { hasLoginAccount: true, loginEmailMatchesRegistration: false }, isLoading: false, isError: false };

function open(p = patient(), onOpenChange = vi.fn(), onSaved = vi.fn()) {
  render(<PatientEditDialog patient={p} open onOpenChange={onOpenChange} onSaved={onSaved} />);
  return { onOpenChange, onSaved };
}

beforeEach(() => {
  state.access = noAccount;
  state.mutate.mockReset();
  state.reset.mockReset();
  state.isPending = false;
  state.isError = false;
  state.error = null;
});

describe("PatientEditDialog — e-mail SEM conta de acesso", () => {
  it("rótulo, selo e helper corretos; campo editável", () => {
    open();
    expect(screen.getByLabelText("E-mail do paciente")).not.toHaveAttribute("readonly");
    expect(screen.getByText("Acesso ainda não ativado")).toBeInTheDocument();
    expect(screen.getByText(/localizar o cadastro quando o paciente acessar o Vertexa pela primeira vez/i)).toBeInTheDocument();
  });

  it("pré-preenche os campos atuais", () => {
    open();
    expect(screen.getByLabelText(/nome completo/i)).toHaveValue("Maria Silva");
    expect(screen.getByLabelText("E-mail do paciente")).toHaveValue("maria@gmail.co");
    expect(screen.getByLabelText("Altura (cm)")).toHaveValue("168");
    expect(screen.getByLabelText("Objetivo")).toHaveValue("Emagrecer");
  });

  it("Salvar fica desabilitado até haver mudança (dirty)", async () => {
    open();
    const save = screen.getByRole("button", { name: /salvar alterações/i });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Objetivo"), "!");
    expect(save).toBeEnabled();
  });

  it("corrige o e-mail e envia o valor novo", async () => {
    open();
    const email = screen.getByLabelText("E-mail do paciente");
    await userEvent.clear(email);
    await userEvent.type(email, "maria@gmail.com");
    await userEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate.mock.calls[0][0]).toMatchObject({
      patientId: "pat-1",
      email: "maria@gmail.com",
      fullName: "Maria Silva",
    });
  });

  it("e-mail inválido não chama a mutation e mostra mensagem", async () => {
    open();
    const email = screen.getByLabelText("E-mail do paciente");
    await userEvent.clear(email);
    await userEvent.type(email, "sem-arroba");
    await userEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));
    expect(state.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/e-mail válido/i);
  });

  it("número inválido não vira null em silêncio", async () => {
    open();
    const h = screen.getByLabelText("Altura (cm)");
    await userEvent.clear(h);
    await userEvent.type(h, "abc");
    await userEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));
    expect(state.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/altura inválida/i);
  });

  it("data de início futura é barrada no cliente", async () => {
    open();
    const d = screen.getByLabelText("Data de início");
    await userEvent.clear(d);
    await userEvent.type(d, "2999-01-01");
    await userEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));
    expect(state.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/futura/i);
  });

  it("start_date é editável e segue no payload", async () => {
    open();
    const d = screen.getByLabelText("Data de início");
    await userEvent.clear(d);
    await userEvent.type(d, "2026-02-01");
    await userEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));
    expect(state.mutate.mock.calls[0][0]).toMatchObject({ startDate: "2026-02-01" });
  });

  it("sucesso fecha o diálogo e avisa o pai", async () => {
    const { onOpenChange, onSaved } = open();
    await userEvent.type(screen.getByLabelText("Objetivo"), "!");
    await userEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));
    const opts = state.mutate.mock.calls[0][1] as { onSuccess: () => void };
    opts.onSuccess();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSaved).toHaveBeenCalled();
  });
});

describe("PatientEditDialog — e-mail COM conta de acesso", () => {
  beforeEach(() => {
    state.access = linked;
  });

  it("rótulo 'E-mail de acesso', somente leitura, selo e helper", () => {
    open(patient({ profile: { id: "pf-1", full_name: "Max", email: "max@gmail.com", auth_user_id: "a-1" } }));
    const input = screen.getByLabelText("E-mail de acesso");
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveValue("max@gmail.com");
    expect(screen.getByText("Conta de acesso vinculada")).toBeInTheDocument();
    expect(screen.getByText(/identidade de login não pode ser alterada diretamente pelo cadastro/i)).toBeInTheDocument();
  });

  it("editar outro campo reenvia o e-mail ATUAL (no-op no servidor), nunca um valor digitado", async () => {
    open(patient({ profile: { id: "pf-1", full_name: "Max", email: "max@gmail.com", auth_user_id: "a-1" } }));
    await userEvent.type(screen.getByLabelText("Objetivo"), "!");
    await userEvent.click(screen.getByRole("button", { name: /salvar alterações/i }));
    expect(state.mutate.mock.calls[0][0]).toMatchObject({ email: "max@gmail.com" });
  });

  it("LEGACY_AUTH_EMAIL_DRIFT: não exibe o e-mail do cadastro como se fosse a identidade", () => {
    state.access = drift;
    open(patient({ profile: { id: "pf-1", full_name: "Max", email: "velho@gmail.com", auth_user_id: "a-1" } }));
    const input = screen.getByLabelText("E-mail de acesso");
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveValue("");
    expect(screen.getByText(/pode ser diferente do e-mail da conta de acesso/i)).toBeInTheDocument();
  });

  it("erro ao consultar o acesso ⇒ fail-closed (somente leitura)", () => {
    state.access = { data: undefined, isLoading: false, isError: true };
    open();
    expect(screen.getByLabelText("E-mail de acesso")).toHaveAttribute("readonly");
  });
});

describe("PatientEditDialog — estados", () => {
  it("acesso carregando: e-mail desabilitado e Salvar bloqueado", async () => {
    state.access = { data: undefined, isLoading: true, isError: false };
    open();
    expect(screen.getByLabelText("E-mail do paciente")).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Objetivo"), "!");
    expect(screen.getByRole("button", { name: /salvar alterações/i })).toBeDisabled();
  });

  it("pendente: botão 'Salvando…' e Cancelar desabilitados (anti double submit)", () => {
    state.isPending = true;
    open();
    expect(screen.getByRole("button", { name: /salvando/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancelar/i })).toBeDisabled();
  });

  it("erro de e-mail duplicado vira a mensagem humana", () => {
    state.isError = true;
    state.error = { hint: "PATIENT_EMAIL_IN_USE", message: "email already in use" };
    open();
    expect(screen.getByRole("alert")).toHaveTextContent("Este e-mail já está associado a outro cadastro.");
  });

  it("Cancelar fecha sem salvar", async () => {
    const { onOpenChange } = open();
    await userEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("nunca mostra termos técnicos ao usuário final", () => {
    open();
    expect(document.body.textContent ?? "").not.toMatch(/supabase|pending|auth_user_id|rpc/i);
  });
});
