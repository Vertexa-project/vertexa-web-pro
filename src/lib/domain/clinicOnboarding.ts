// Regras de onboarding de clínica — PURAS (sem I/O), testáveis em Node.
// Espelham a RPC public.create_clinic_with_owner (WP-ONBOARDING): validação do nome idêntica ao banco
// (obrigatório; 2..120) e tradução dos erros da RPC (via `hint`) para mensagem COMPREENSÍVEL ao usuário
// — nunca erro cru, nunca PII. Mantêm a autoridade no banco; aqui é só UX e classificação de erro.

export const CLINIC_NAME_MIN = 2;
export const CLINIC_NAME_MAX = 120;

export type ClinicNameValidation =
  | { ok: true; value: string }
  | { ok: false; message: string };

/** Valida/normaliza o nome com as MESMAS regras do banco (obrigatório; 2..120 chars, após trim). */
export function validateClinicName(raw: string): ClinicNameValidation {
  const value = raw.trim();
  if (value === "") return { ok: false, message: "Informe o nome da clínica." };
  if (value.length < CLINIC_NAME_MIN)
    return { ok: false, message: `O nome precisa ter ao menos ${CLINIC_NAME_MIN} caracteres.` };
  if (value.length > CLINIC_NAME_MAX)
    return { ok: false, message: `O nome pode ter no máximo ${CLINIC_NAME_MAX} caracteres.` };
  return { ok: true, value };
}

// Códigos (hint) emitidos pela RPC → mensagem amigável. Mantidos em sincronia com a migration
// 20260801090000 (create_clinic_with_owner). O PORTÃO COMERCIAL futuro emitirá ONBOARDING_NOT_ALLOWED
// pelo MESMO caminho — já mapeado aqui, sem precisar tocar na UI quando ele for ligado.
const HINT_MESSAGES: Record<string, string> = {
  ALREADY_OWNS_CLINIC:
    "Você já é dona(o) de uma clínica. Cada perfil pode criar apenas uma clínica.",
  NAME_REQUIRED: "Informe o nome da clínica.",
  NAME_TOO_SHORT: `O nome precisa ter ao menos ${CLINIC_NAME_MIN} caracteres.`,
  NAME_TOO_LONG: `O nome pode ter no máximo ${CLINIC_NAME_MAX} caracteres.`,
  NOT_AUTHENTICATED: "Sua sessão expirou. Entre novamente para criar a clínica.",
  ONBOARDING_NOT_ALLOWED: "A criação de clínicas ainda não está liberada para esta conta.",
};

/** Extrai um `hint` CONHECIDO de um erro de RPC (PostgrestError expõe `hint`). Senão, null. */
export function onboardingErrorHint(error: unknown): string | null {
  if (error && typeof error === "object" && "hint" in error) {
    const hint = (error as { hint?: unknown }).hint;
    if (typeof hint === "string" && hint in HINT_MESSAGES) return hint;
  }
  return null;
}

/** Erro ESPERADO (validação/guarda-corpo) — não deve ir ao Sentry (evita ruído), como isDisciplineDenied. */
export function isExpectedOnboardingError(error: unknown): boolean {
  return onboardingErrorHint(error) !== null;
}

/** Mensagem compreensível para QUALQUER erro da criação (nunca erro cru; sem PII). */
export function onboardingErrorMessage(error: unknown): string {
  const hint = onboardingErrorHint(error);
  if (hint) return HINT_MESSAGES[hint];
  return "Não foi possível criar a clínica agora. Tente novamente em instantes.";
}
