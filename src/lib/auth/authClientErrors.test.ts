import { describe, expect, it } from "vitest";

import { AUTH_RATE_LIMIT_MESSAGE, isAuthRateLimitedError } from "./authClientErrors";

describe("isAuthRateLimitedError", () => {
  it("reconhece HTTP 429", () => {
    expect(isAuthRateLimitedError({ status: 429, message: "Request rate limit reached" })).toBe(true);
  });

  it("reconhece código GoTrue de envio de e-mail", () => {
    expect(isAuthRateLimitedError({ code: "over_email_send_rate_limit", message: "email rate limit" })).toBe(
      true,
    );
  });

  it("não classifica credencial inválida como rate limit", () => {
    expect(isAuthRateLimitedError({ status: 400, message: "Invalid login credentials" })).toBe(false);
    expect(isAuthRateLimitedError({ message: "Email not confirmed" })).toBe(false);
    expect(isAuthRateLimitedError(null)).toBe(false);
  });
});

describe("AUTH_RATE_LIMIT_MESSAGE", () => {
  it("é amigável e não convida a reenviar em loop", () => {
    expect(AUTH_RATE_LIMIT_MESSAGE).toMatch(/aguarde/i);
    expect(AUTH_RATE_LIMIT_MESSAGE.toLowerCase()).not.toContain("reenviar");
  });
});
