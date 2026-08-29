import { supabase } from "@/lib/supabase";
import { isValidResetEmail, passwordResetRedirectTo } from "@/lib/auth/passwordRecovery";
import { captureException } from "@/lib/observability/sentry";

/**
 * Pede o e-mail de recovery ao GoTrue. A UI sempre mostra a mesma mensagem
 * (anti-enumeration): erro de rede/GoTrue não revela se a conta existe.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  if (!isValidResetEmail(email)) return;

  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: passwordResetRedirectTo(window.location.origin),
  });

  if (error) {
    captureException(error, { source: "auth", scope: "password-reset-request" });
  }
}

/** Redefine a senha da sessão de recovery atual. Não loga o valor. */
export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}
