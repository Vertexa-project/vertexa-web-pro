import { AUTH_RATE_LIMIT_MESSAGE, isAuthRateLimitedError } from "./authClientErrors";

export const CREATE_PASSWORD_SUCCESS_MESSAGE =
  "Senha definida. Agora você também pode entrar com e-mail e senha.";

export const CREATE_PASSWORD_GENERIC_MESSAGE =
  "Não foi possível criar a senha agora. Tente novamente em instantes.";

export const CREATE_PASSWORD_LEAKED_MESSAGE =
  "Esta senha não pode ser usada. Escolha outra.";

export const CREATE_PASSWORD_REAUTH_MESSAGE =
  "Por segurança, entre novamente e tente criar a senha.";

export type CreatePasswordErrorKind =
  | "rate_limited"
  | "rejected_password"
  | "reauth_required"
  | "failed";

export type CreatePasswordError = {
  kind: CreatePasswordErrorKind;
  message: string;
};

function asRecord(error: unknown): Record<string, unknown> | null {
  return error && typeof error === "object" ? (error as Record<string, unknown>) : null;
}

function textOf(error: unknown): string {
  const record = asRecord(error);
  const code = typeof record?.code === "string" ? record.code : "";
  const message = typeof record?.message === "string" ? record.message : "";
  return `${code} ${message}`.toLowerCase();
}

export function classifyCreatePasswordError(error: unknown): CreatePasswordError {
  if (isAuthRateLimitedError(error)) {
    return { kind: "rate_limited", message: AUTH_RATE_LIMIT_MESSAGE };
  }

  const text = textOf(error);
  if (
    text.includes("reauthentication") ||
    text.includes("reauth") ||
    text.includes("session too old") ||
    text.includes("fresh authentication")
  ) {
    return { kind: "reauth_required", message: CREATE_PASSWORD_REAUTH_MESSAGE };
  }

  if (
    text.includes("weak_password") ||
    text.includes("leaked") ||
    text.includes("pwned") ||
    text.includes("compromised") ||
    text.includes("same_password") ||
    text.includes("should be different")
  ) {
    return { kind: "rejected_password", message: CREATE_PASSWORD_LEAKED_MESSAGE };
  }

  return { kind: "failed", message: CREATE_PASSWORD_GENERIC_MESSAGE };
}
