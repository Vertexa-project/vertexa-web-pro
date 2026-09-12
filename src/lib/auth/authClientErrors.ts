/** Erros de Auth classificados para UX — sem vazar existência de conta. */

export const AUTH_RATE_LIMIT_MESSAGE =
  "Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente.";

export const LOGIN_INVALID_CREDENTIALS_MESSAGE =
  "E-mail ou senha inválidos. Verifique seus dados e tente novamente.";

export const SIGNUP_GENERIC_ERROR_MESSAGE =
  "Não foi possível concluir o cadastro agora. Tente novamente em instantes.";

function asRecord(error: unknown): Record<string, unknown> | null {
  return error && typeof error === "object" ? (error as Record<string, unknown>) : null;
}

export function isAuthRateLimitedError(error: unknown): boolean {
  const record = asRecord(error);
  if (!record) return false;
  if (record.status === 429) return true;
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") return true;
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  return message.includes("rate limit") || message.includes("too many requests");
}

/** Duplicata / identidade já existente — a UI deve tratar como "confira o e-mail". */
export function isNeutralSignupDuplicateError(error: unknown): boolean {
  const record = asRecord(error);
  if (!record) return false;
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  if (code === "user_already_exists" || code === "email_exists") return true;
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  return (
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("user already exists")
  );
}
