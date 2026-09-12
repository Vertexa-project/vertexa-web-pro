import { describe, expect, it } from "vitest";

import { AUTH_CALLBACK_PATH, PASSWORD_MIN_LENGTH } from "./passwordRecovery";
import {
  AUTH_SIGNUP_PATH,
  SIGNUP_CHECK_EMAIL_BODY,
  SIGNUP_CHECK_EMAIL_TITLE,
  buildSignUpRequest,
  signupEmailRedirectTo,
  validateSignupForm,
} from "./signup";

describe("AUTH-EMAIL-02 — rotas e redirect de signup", () => {
  it("rota dedicada é /auth/signup", () => {
    expect(AUTH_SIGNUP_PATH).toBe("/auth/signup");
  });

  it("emailRedirectTo termina em /auth/callback no origin atual", () => {
    expect(signupEmailRedirectTo("http://localhost:5173")).toBe("http://localhost:5173/auth/callback");
    expect(signupEmailRedirectTo("http://localhost:5173/")).toBe("http://localhost:5173/auth/callback");
    expect(signupEmailRedirectTo("https://app.vertexa.app.br").endsWith(AUTH_CALLBACK_PATH)).toBe(true);
    expect(signupEmailRedirectTo("https://preview.example").includes("vertexa-web-pro.vercel.app")).toBe(
      false,
    );
  });
});

describe("validateSignupForm", () => {
  const valid = {
    fullName: "Ana Costa",
    email: "ana@clinica.com",
    password: "abcdefgh",
    confirmation: "abcdefgh",
  };

  it("aceita nome, e-mail e senha com 8 caracteres sem complexidade extra", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(validateSignupForm(valid)).toEqual({
      ok: true,
      fullName: "Ana Costa",
      email: "ana@clinica.com",
      password: "abcdefgh",
    });
  });

  it("rejeita nome vazio", () => {
    expect(validateSignupForm({ ...valid, fullName: "   " })).toEqual({
      ok: false,
      field: "fullName",
      message: "Informe seu nome completo.",
    });
  });

  it("rejeita e-mail inválido", () => {
    const result = validateSignupForm({ ...valid, email: "nao-e-email" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("email");
  });

  it("rejeita senha com 7 caracteres", () => {
    expect(validateSignupForm({ ...valid, password: "abcdefg", confirmation: "abcdefg" })).toEqual({
      ok: false,
      field: "password",
      message: "A senha deve ter pelo menos 8 caracteres.",
    });
  });

  it("não exige maiúscula, número ou símbolo", () => {
    expect(validateSignupForm({ ...valid, password: "senhafrac", confirmation: "senhafrac" }).ok).toBe(
      true,
    );
  });

  it("rejeita senhas divergentes", () => {
    expect(validateSignupForm({ ...valid, confirmation: "abcdefghx" })).toEqual({
      ok: false,
      field: "confirmation",
      message: "As senhas não coincidem.",
    });
  });
});

describe("buildSignUpRequest — sem autoridade no metadata", () => {
  it("envia só full_name e signup_surface=web", () => {
    const request = buildSignUpRequest({
      email: " ana@clinica.com ",
      password: "abcdefgh",
      fullName: " Ana Costa ",
      origin: "http://localhost:5173",
    });

    expect(request.email).toBe("ana@clinica.com");
    expect(request.password).toBe("abcdefgh");
    expect(request.options.emailRedirectTo).toBe("http://localhost:5173/auth/callback");
    expect(request.options.data).toEqual({
      full_name: "Ana Costa",
      signup_surface: "web",
    });
    expect(request.options.data).not.toHaveProperty("role");
    expect(request.options.data).not.toHaveProperty("clinic_id");
    expect(request.options.data).not.toHaveProperty("is_admin");
    expect(request.options.data).not.toHaveProperty("professional_id");
    expect(JSON.stringify(request)).not.toContain("admin");
  });
});

describe("anti-enumeration copy de signup", () => {
  it("sucesso é Confira seu e-mail, sem revelar conta existente", () => {
    expect(SIGNUP_CHECK_EMAIL_TITLE).toBe("Confira seu e-mail");
    expect(SIGNUP_CHECK_EMAIL_BODY.toLowerCase()).not.toContain("já cadastrado");
    expect(SIGNUP_CHECK_EMAIL_BODY.toLowerCase()).not.toContain("google");
    expect(SIGNUP_CHECK_EMAIL_BODY.toLowerCase()).not.toContain("paciente");
    expect(SIGNUP_CHECK_EMAIL_BODY.toLowerCase()).not.toContain("inexistente");
  });
});
