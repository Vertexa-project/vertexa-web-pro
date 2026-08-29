import { describe, expect, it } from "vitest";

import {
  AUTH_CALLBACK_PATH,
  PASSWORD_FORGOT_PATH,
  PASSWORD_RESET_NOTICE,
  PASSWORD_RESET_PATH,
  classifyAuthUrlError,
  isPasswordRecoveryEvent,
  isPasswordRecoveryUrl,
  isValidResetEmail,
  passwordResetRedirectTo,
  resolveUpdatePasswordView,
  shouldRouteToPasswordRecovery,
  validateNewPassword,
} from "./passwordRecovery";

describe("passwordResetRedirectTo", () => {
  it("R4 — termina em /auth/update-password sem hardcodar domínio", () => {
    expect(passwordResetRedirectTo("https://vertexa-web-pro.vercel.app")).toBe(
      "https://vertexa-web-pro.vercel.app/auth/update-password",
    );
    expect(passwordResetRedirectTo("http://localhost:5173")).toBe(
      "http://localhost:5173/auth/update-password",
    );
    expect(passwordResetRedirectTo("http://localhost:5173/")).toBe(
      "http://localhost:5173/auth/update-password",
    );
    expect(passwordResetRedirectTo("https://preview.example").endsWith(PASSWORD_RESET_PATH)).toBe(
      true,
    );
  });
});

describe("classifyAuthUrlError — NÃO usa error_description", () => {
  it("otp_expired no hash (caso real AUTH-03A) é expirado", () => {
    expect(
      classifyAuthUrlError(
        "#error=access_denied&error_code=otp_expired&error_description=Email%20link%20is%20invalid%20or%20has%20expired",
      ),
    ).toBe("expired");
  });

  it("error_code=otp_expired no search também é expirado", () => {
    expect(classifyAuthUrlError("", "?error=access_denied&error_code=otp_expired")).toBe("expired");
  });

  it("error=access_denied sem code ainda é falha de link (denied)", () => {
    expect(classifyAuthUrlError("#error=access_denied")).toBe("denied");
  });

  it("error_description sozinha NÃO classifica erro", () => {
    expect(classifyAuthUrlError("#error_description=Email%20link%20is%20invalid%20or%20has%20expired")).toBe(
      "none",
    );
  });

  it("sem fragmento de erro ⇒ none", () => {
    expect(classifyAuthUrlError("", "")).toBe("none");
    expect(classifyAuthUrlError("#type=recovery")).toBe("none");
  });
});

describe("isPasswordRecoveryUrl", () => {
  it("type=recovery no hash ou search", () => {
    expect(isPasswordRecoveryUrl("#type=recovery&access_token=x")).toBe(true);
    expect(isPasswordRecoveryUrl("", "?type=recovery&code=abc")).toBe(true);
    expect(isPasswordRecoveryUrl("", "?code=abc")).toBe(false);
    expect(isPasswordRecoveryUrl("")).toBe(false);
  });
});

describe("shouldRouteToPasswordRecovery", () => {
  it("link expirado em / (SITE_URL) deve ir para update-password", () => {
    expect(
      shouldRouteToPasswordRecovery({
        pathname: "/",
        hash: "#error=access_denied&error_code=otp_expired",
        search: "",
      }),
    ).toBe(true);
  });

  it("type=recovery em rota clínica deve ir para update-password", () => {
    expect(
      shouldRouteToPasswordRecovery({
        pathname: "/",
        hash: "#type=recovery",
        search: "",
      }),
    ).toBe(true);
  });

  it("já em /auth/update-password não redireciona de novo", () => {
    expect(
      shouldRouteToPasswordRecovery({
        pathname: PASSWORD_RESET_PATH,
        hash: "#error=access_denied&error_code=otp_expired",
        search: "",
      }),
    ).toBe(false);
  });

  it("/auth/callback com erro OAuth NÃO é sequestrado pelo recovery", () => {
    expect(
      shouldRouteToPasswordRecovery({
        pathname: AUTH_CALLBACK_PATH,
        hash: "",
        search: "?error=access_denied",
      }),
    ).toBe(false);
  });

  it("login sem fragmento de auth não redireciona", () => {
    expect(
      shouldRouteToPasswordRecovery({
        pathname: "/login",
        hash: "",
        search: "",
      }),
    ).toBe(false);
  });
});

describe("resolveUpdatePasswordView", () => {
  it("R7 — erro de URL ⇒ estado inválido/expirado", () => {
    expect(
      resolveUpdatePasswordView({
        authLoading: false,
        isPasswordRecovery: false,
        urlError: "expired",
      }),
    ).toBe("invalid");
  });

  it("R10 — recovery válido ⇒ formulário", () => {
    expect(
      resolveUpdatePasswordView({
        authLoading: false,
        isPasswordRecovery: true,
        urlError: "none",
      }),
    ).toBe("form");
  });

  it("erro de URL vence recovery (não mostrar form em link morto)", () => {
    expect(
      resolveUpdatePasswordView({
        authLoading: false,
        isPasswordRecovery: true,
        urlError: "expired",
      }),
    ).toBe("invalid");
  });

  it("sessão comum sem recovery ⇒ inválido (não é tela de troca logada)", () => {
    expect(
      resolveUpdatePasswordView({
        authLoading: false,
        isPasswordRecovery: false,
        urlError: "none",
      }),
    ).toBe("invalid");
  });

  it("enquanto auth carrega, espera", () => {
    expect(
      resolveUpdatePasswordView({
        authLoading: true,
        isPasswordRecovery: false,
        urlError: "none",
      }),
    ).toBe("loading");
  });
});

describe("isValidResetEmail — R2", () => {
  it("vazio ou sem formato não envia", () => {
    expect(isValidResetEmail("")).toBe(false);
    expect(isValidResetEmail("   ")).toBe(false);
    expect(isValidResetEmail("nao-e-email")).toBe(false);
  });

  it("e-mail simples é aceito", () => {
    expect(isValidResetEmail("pessoa@clinica.com")).toBe(true);
    expect(isValidResetEmail("  pessoa@clinica.com  ")).toBe(true);
  });
});

describe("validateNewPassword — R11", () => {
  it("senhas divergentes não passam", () => {
    expect(validateNewPassword("abcdef", "abcdeg")).toEqual({ ok: false, reason: "mismatch" });
  });

  it("abaixo do mínimo GoTrue (6) não passa", () => {
    expect(validateNewPassword("abc", "abc")).toEqual({ ok: false, reason: "too_short" });
  });

  it("iguais e com tamanho mínimo passam", () => {
    expect(validateNewPassword("abcdef", "abcdef")).toEqual({ ok: true });
  });
});

describe("anti-enumeration copy", () => {
  it("R5 — mensagem genérica única", () => {
    expect(PASSWORD_RESET_NOTICE).toBe(
      "Se houver uma conta vinculada a este e-mail, enviaremos as instruções para redefinir sua senha.",
    );
  });

  it("rotas auth-special são estáveis", () => {
    expect(PASSWORD_RESET_PATH).toBe("/auth/update-password");
    expect(PASSWORD_FORGOT_PATH).toBe("/auth/forgot-password");
  });
});

describe("isPasswordRecoveryEvent", () => {
  it("só PASSWORD_RECOVERY liga o fluxo", () => {
    expect(isPasswordRecoveryEvent("PASSWORD_RECOVERY")).toBe(true);
    expect(isPasswordRecoveryEvent("SIGNED_IN")).toBe(false);
    expect(isPasswordRecoveryEvent("INITIAL_SESSION")).toBe(false);
    expect(isPasswordRecoveryEvent("USER_UPDATED")).toBe(false);
  });
});
