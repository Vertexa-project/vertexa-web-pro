import { supabase } from "@/lib/supabase";
import { isAuthRateLimitedError } from "@/lib/auth/authClientErrors";
import { isValidResetEmail, passwordResetRedirectTo } from "@/lib/auth/passwordRecovery";
import { captureException } from "@/lib/observability/sentry";

export type PasswordResetRequestResult = { kind: "sent" } | { kind: "rate_limited" };

/**
 * Pede o e-mail de recovery ao GoTrue. A UI sempre mostra a mesma mensagem
 * (anti-enumeration): erro de rede/GoTrue não revela se a conta existe.
 * Rate limit é a única falha distinguível — não enumera conta.
 */
export async function requestPasswordReset(email: string): Promise<PasswordResetRequestResult> {
  if (!isValidResetEmail(email)) return { kind: "sent" };

  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: passwordResetRedirectTo(window.location.origin),
  });

  if (error) {
    if (isAuthRateLimitedError(error)) return { kind: "rate_limited" };
    captureException(error, { source: "auth", scope: "password-reset-request" });
  }

  return { kind: "sent" };
}

/** Redefine a senha da sessão de recovery atual. Não loga o valor. */
export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}
