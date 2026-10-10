// WP-PATIENT-DIAG-DELETE-01 — regras PURAS da exclusão de cadastro não utilizado (sem I/O).
// O servidor (get_patient_deletion_eligibility / delete_unused_patient_registration) é a
// autoridade; aqui só tradução de códigos para linguagem humana e a trava de confirmação.

import { patientRegistrationErrorHint } from "@/lib/domain/patientRegistration";

/** Texto que o admin precisa digitar para liberar a exclusão. */
export const PATIENT_DELETE_CONFIRM_WORD = "EXCLUIR";

export function isPatientDeleteConfirmed(typed: string): boolean {
  return typed.trim() === PATIENT_DELETE_CONFIRM_WORD;
}

const ACCESS_MESSAGE = "Este paciente já possui uma conta de acesso vinculada.";
const IDENTITY_MESSAGE =
  "Já existe uma conta de acesso ou outro cadastro com este e-mail. Para não afetar o acesso do paciente, este cadastro não pode ser excluído.";
const CLINICAL_MESSAGE =
  "Para preservar o histórico clínico, cadastros que já possuem dados não podem ser excluídos.";
const ACTIVITY_MESSAGE = "Este paciente já possui movimentações na plataforma e não pode ser excluído.";
const ADMIN_MESSAGE = "Somente administradores da clínica podem excluir cadastros.";

const REASONS: Record<string, string> = {
  PATIENT_DELETE_AUTH_LINKED: ACCESS_MESSAGE,
  PATIENT_DELETE_AUTH_EMAIL_CONFLICT: IDENTITY_MESSAGE,
  PATIENT_DELETE_AMBIGUOUS_IDENTITY: IDENTITY_MESSAGE,
  PATIENT_DELETE_HAS_CLINICAL_DATA: CLINICAL_MESSAGE,
  PATIENT_DELETE_HAS_DOCUMENTS: CLINICAL_MESSAGE,
  PATIENT_DELETE_HAS_PLANS: ACTIVITY_MESSAGE,
  PATIENT_DELETE_HAS_MESSAGES: ACTIVITY_MESSAGE,
  PATIENT_DELETE_HAS_ACTIVITY: ACTIVITY_MESSAGE,
  PATIENT_DELETE_NOT_ADMIN: ADMIN_MESSAGE,
  PATIENT_DELETE_FOREIGN_CLINIC: ADMIN_MESSAGE,
};

export type PatientDeleteUi =
  | { kind: "loading" }
  | { kind: "eligible" }
  | { kind: "blocked"; message: string };

/**
 * FAIL-CLOSED: carregando, erro, resposta ausente ou código desconhecido ⇒ ação indisponível.
 * Nunca expõe nome de tabela nem código técnico.
 */
export function resolvePatientDeleteUi(input: {
  data: { eligible: boolean; reason: string } | undefined;
  isLoading: boolean;
  isError: boolean;
}): PatientDeleteUi {
  if (input.isLoading) return { kind: "loading" };
  if (input.isError || !input.data) {
    return { kind: "blocked", message: "Não foi possível verificar se este cadastro pode ser excluído." };
  }
  if (input.data.eligible && input.data.reason === "PATIENT_DELETE_ELIGIBLE") return { kind: "eligible" };
  return { kind: "blocked", message: REASONS[input.data.reason] ?? ACTIVITY_MESSAGE };
}

const ERRORS: Record<string, string> = {
  ...REASONS,
  PATIENT_NOT_FOUND: "Este cadastro não existe mais.",
  CLINIC_NOT_OPERATIONAL: "A clínica não está operacional no momento.",
  PATIENT_CHANGED_CONCURRENTLY: "O cadastro foi alterado por outra pessoa. Feche, reabra e tente novamente.",
  NOT_AUTHENTICATED: "Sua sessão expirou. Entre novamente.",
};

export const PATIENT_DELETE_GENERIC_ERROR = "Não foi possível excluir o cadastro. Tente novamente.";

export function patientDeleteErrorMessage(err: unknown): string {
  return ERRORS[patientRegistrationErrorHint(err)] ?? PATIENT_DELETE_GENERIC_ERROR;
}
