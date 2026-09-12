import { isValidResetEmail, PASSWORD_MIN_LENGTH, validateNewPassword } from "./passwordRecovery";

/** Rota dedicada de cadastro profissional. Fora do LoginPage. */
export const AUTH_SIGNUP_PATH = "/auth/signup";

export const SIGNUP_CHECK_EMAIL_TITLE = "Confira seu e-mail";

export const SIGNUP_CHECK_EMAIL_BODY =
  "Se este e-mail puder receber mensagens, enviamos um link para confirmar sua conta. Depois de confirmar, você poderá entrar.";

export type SignupField = "fullName" | "email" | "password" | "confirmation";

export type SignupValidation =
  | { ok: true; fullName: string; email: string; password: string }
  | { ok: false; field: SignupField; message: string };

export function signupEmailRedirectTo(origin: string): string {
  return `${origin.replace(/\/$/, "")}/auth/callback`;
}

export function validateSignupForm(input: {
  fullName: string;
  email: string;
  password: string;
  confirmation: string;
}): SignupValidation {
  const fullName = input.fullName.trim();
  if (fullName.length === 0) {
    return { ok: false, field: "fullName", message: "Informe seu nome completo." };
  }

  const email = input.email.trim();
  if (!isValidResetEmail(email)) {
    return { ok: false, field: "email", message: "Informe um e-mail válido." };
  }

  const passwordCheck = validateNewPassword(input.password, input.confirmation);
  if (!passwordCheck.ok) {
    if (passwordCheck.reason === "mismatch") {
      return { ok: false, field: "confirmation", message: "As senhas não coincidem." };
    }
    return {
      ok: false,
      field: "password",
      message: `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    };
  }

  return { ok: true, fullName, email, password: input.password };
}

/** Payload único do signUp — sem role, clínica ou flags de autoridade. */
export function buildSignUpRequest(input: {
  email: string;
  password: string;
  fullName: string;
  origin: string;
}): {
  email: string;
  password: string;
  options: {
    emailRedirectTo: string;
    data: { full_name: string; signup_surface: "web" };
  };
} {
  return {
    email: input.email.trim(),
    password: input.password,
    options: {
      emailRedirectTo: signupEmailRedirectTo(input.origin),
      data: {
        full_name: input.fullName.trim(),
        signup_surface: "web",
      },
    },
  };
}
