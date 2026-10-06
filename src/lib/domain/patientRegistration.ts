// WP-PATIENT-ADMIN-EDIT-01 — regras PURAS da edição de cadastro do paciente (sem I/O).
// O servidor (RPC update_patient_registration) é a autoridade; aqui só validação de UX e
// tradução de erros de domínio para mensagens humanas.

/** Mesma regra do servidor: trim + lowercase para COMPARAR. Sem heurística de Gmail
 *  (john.smith@gmail.com e johnsmith@gmail.com NÃO são o mesmo e-mail). */
export function normalizePatientEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

// Espelha o CHECK sintático da RPC: algo@dominio.tld, sem espaços.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type EmailValidation = { ok: true; value: string | null } | { ok: false; message: string };

/**
 * Valida o e-mail do cadastro.
 * - vazio + não havia e-mail antes  → ok (null)
 * - vazio + havia e-mail antes      → erro (o servidor também não permite limpar)
 * - preenchido                      → sintaxe
 */
export function validatePatientEmail(raw: string, hadEmail: boolean): EmailValidation {
  const v = raw.trim();
  if (!v) {
    return hadEmail
      ? { ok: false, message: "O e-mail do paciente não pode ser removido." }
      : { ok: true, value: null };
  }
  if (!EMAIL_RE.test(v)) return { ok: false, message: "Informe um e-mail válido." };
  return { ok: true, value: v };
}

export type DecimalParse = { ok: true; value: number | null } | { ok: false };

/** "72,5" → 72.5; "" → null; texto não numérico → ok:false (NUNCA vira null em silêncio). */
export function parseDecimalField(raw: string): DecimalParse {
  const t = raw.trim().replace(",", ".");
  if (!t) return { ok: true, value: null };
  const n = Number(t);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

/** Lê a `hint` do erro do PostgREST/Postgres (convenção UPPER_SNAKE do projeto). */
export function patientRegistrationErrorHint(err: unknown): string {
  if (err && typeof err === "object" && "hint" in err) {
    return String((err as { hint?: unknown }).hint ?? "");
  }
  return "";
}

const MESSAGES: Record<string, string> = {
  PATIENT_EMAIL_IN_USE: "Este e-mail já está associado a outro cadastro.",
  PATIENT_LOGIN_EMAIL_ALREADY_CLAIMED:
    "Este paciente já possui uma conta de acesso vinculada. O e-mail de login não pode ser alterado pelo cadastro.",
  PATIENT_EMAIL_INVALID: "Informe um e-mail válido.",
  PATIENT_NAME_REQUIRED: "Informe o nome do paciente.",
  PATIENT_FIELD_INVALID: "Confira os dados informados (datas, medidas e sexo).",
  PATIENT_EDIT_ADMIN_REQUIRED: "Somente administradores da clínica podem editar o cadastro do paciente.",
  CLINIC_NOT_OPERATIONAL: "A clínica não está operacional no momento.",
  PATIENT_CHANGED_CONCURRENTLY: "O cadastro foi alterado por outra pessoa. Feche, reabra e tente novamente.",
  PATIENT_NOT_FOUND: "Paciente não encontrado.",
  NOT_AUTHENTICATED: "Sua sessão expirou. Entre novamente.",
};

export const PATIENT_REGISTRATION_GENERIC_ERROR = "Não foi possível salvar o cadastro. Tente novamente.";

export function patientRegistrationErrorMessage(err: unknown): string {
  return MESSAGES[patientRegistrationErrorHint(err)] ?? PATIENT_REGISTRATION_GENERIC_ERROR;
}

/** Estado de acesso do paciente para a UI do admin (derivado da RPC de leitura). */
export type PatientAccessUi =
  | { kind: "loading" }
  | { kind: "no-account" } // e-mail editável
  | { kind: "linked"; emailTrusted: boolean }; // e-mail de login somente leitura

/**
 * FAIL-CLOSED: sem resposta confiável (carregando/erro) o e-mail NÃO é editável.
 * `emailTrusted=false` ⇒ o e-mail do cadastro diverge do e-mail real da conta (LEGACY_AUTH_EMAIL_DRIFT):
 * a UI não o exibe como se fosse a identidade de login.
 */
export function resolvePatientAccessUi(input: {
  data: { hasLoginAccount: boolean; loginEmailMatchesRegistration: boolean | null } | undefined;
  isLoading: boolean;
  isError: boolean;
}): PatientAccessUi {
  if (input.isLoading) return { kind: "loading" };
  if (input.isError || !input.data) return { kind: "linked", emailTrusted: false };
  if (!input.data.hasLoginAccount) return { kind: "no-account" };
  return { kind: "linked", emailTrusted: input.data.loginEmailMatchesRegistration === true };
}
