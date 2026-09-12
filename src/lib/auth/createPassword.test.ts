import { describe, expect, it } from "vitest";

import {
  CREATE_PASSWORD_GENERIC_MESSAGE,
  CREATE_PASSWORD_LEAKED_MESSAGE,
  CREATE_PASSWORD_REAUTH_MESSAGE,
  CREATE_PASSWORD_SUCCESS_MESSAGE,
  classifyCreatePasswordError,
} from "./createPassword";
import { AUTH_RATE_LIMIT_MESSAGE } from "./authClientErrors";

describe("classifyCreatePasswordError", () => {
  it("rate limit", () => {
    expect(classifyCreatePasswordError({ status: 429, message: "too many requests" })).toEqual({
      kind: "rate_limited",
      message: AUTH_RATE_LIMIT_MESSAGE,
    });
  });

  it("senha vazada/fraca", () => {
    expect(classifyCreatePasswordError({ code: "weak_password", message: "leaked" }).kind).toBe(
      "rejected_password",
    );
    expect(classifyCreatePasswordError({ message: "Password is known to be leaked" }).message).toBe(
      CREATE_PASSWORD_LEAKED_MESSAGE,
    );
  });

  it("reauth necessária", () => {
    expect(
      classifyCreatePasswordError({ code: "reauthentication_needed", message: "reauth" }),
    ).toEqual({
      kind: "reauth_required",
      message: CREATE_PASSWORD_REAUTH_MESSAGE,
    });
  });

  it("falha genérica sem vazar internals", () => {
    const result = classifyCreatePasswordError({ message: "AuthApiError: unexpected" });
    expect(result.kind).toBe("failed");
    expect(result.message).toBe(CREATE_PASSWORD_GENERIC_MESSAGE);
    expect(result.message.toLowerCase()).not.toContain("authapi");
  });
});

describe("CREATE_PASSWORD_SUCCESS_MESSAGE", () => {
  it("afirma o novo método sem falar em cadastro clínico", () => {
    expect(CREATE_PASSWORD_SUCCESS_MESSAGE.toLowerCase()).toContain("definida");
    expect(CREATE_PASSWORD_SUCCESS_MESSAGE.toLowerCase()).toContain("e-mail e senha");
    expect(CREATE_PASSWORD_SUCCESS_MESSAGE.toLowerCase()).not.toContain("criada");
    expect(CREATE_PASSWORD_SUCCESS_MESSAGE.toLowerCase()).not.toContain("paciente");
    expect(CREATE_PASSWORD_SUCCESS_MESSAGE.toLowerCase()).not.toContain("clínica");
  });
});
