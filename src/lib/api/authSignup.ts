import { supabase } from "@/lib/supabase";
import { isAuthRateLimitedError, isNeutralSignupDuplicateError } from "@/lib/auth/authClientErrors";
import { buildSignUpRequest } from "@/lib/auth/signup";
import { captureException } from "@/lib/observability/sentry";

export type SignUpWithEmailInput = {
  email: string;
  password: string;
  fullName: string;
};

export type SignUpWithEmailResult = { kind: "check_email" } | { kind: "rate_limited" } | { kind: "failed" };

/**
 * Cadastro e-mail/senha. Confirm email ON: em geral não há sessão.
 * Duplicata (incluindo conta Google no mesmo e-mail) vira o mesmo estado neutro.
 * Nunca envia role, clinic_id, is_admin ou professional_id.
 */
export async function signUpWithEmail(input: SignUpWithEmailInput): Promise<SignUpWithEmailResult> {
  const payload = buildSignUpRequest({
    ...input,
    origin: window.location.origin,
  });

  const { error } = await supabase.auth.signUp(payload);

  if (!error) return { kind: "check_email" };
  if (isAuthRateLimitedError(error)) return { kind: "rate_limited" };
  if (isNeutralSignupDuplicateError(error)) return { kind: "check_email" };

  captureException(error, { source: "auth", scope: "signup" });
  return { kind: "failed" };
}
