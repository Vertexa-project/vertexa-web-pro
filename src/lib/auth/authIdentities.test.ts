import { describe, expect, it } from "vitest";

import {
  canDefinePasswordForCurrentIdentity,
  collectAuthProviders,
  hasOAuthIdentity,
  hasReportedEmailIdentity,
  oauthPasswordSetupCopy,
  resolvePasswordSetupUX,
} from "./authIdentities";

function user(input: {
  providers?: string[];
  identities?: string[];
  provider?: string;
} | null) {
  if (!input) return null;
  return {
    app_metadata: {
      provider: input.provider,
      providers: input.providers,
    },
    identities: input.identities?.map((provider) => ({ provider })),
  };
}

describe("collectAuthProviders", () => {
  it("une app_metadata.providers e identities, sem duplicar", () => {
    expect(
      collectAuthProviders(user({ providers: ["google"], identities: ["google", "email"] })),
    ).toEqual(["email", "google"]);
  });
});

describe("resolvePasswordSetupUX", () => {
  it("['email'] → senha reportada como configurada", () => {
    const u = user({ providers: ["email"], identities: ["email"] });
    expect(hasReportedEmailIdentity(u)).toBe(true);
    expect(resolvePasswordSetupUX(u)).toBe("reported_password_configured");
    expect(canDefinePasswordForCurrentIdentity(u)).toBe(false);
  });

  it("['google','email'] → senha reportada como configurada", () => {
    const u = user({ providers: ["google", "email"], identities: ["google", "email"] });
    expect(hasReportedEmailIdentity(u)).toBe(true);
    expect(hasOAuthIdentity(u)).toBe(true);
    expect(resolvePasswordSetupUX(u)).toBe("reported_password_configured");
    expect(canDefinePasswordForCurrentIdentity(u)).toBe(false);
  });

  it("['google'] → capability UNKNOWN; pode definir senha; NÃO afirma ausência", () => {
    const u = user({ providers: ["google"], identities: ["google"] });
    expect(hasReportedEmailIdentity(u)).toBe(false);
    expect(hasOAuthIdentity(u)).toBe(true);
    expect(resolvePasswordSetupUX(u)).toBe("can_define_password");
    expect(canDefinePasswordForCurrentIdentity(u)).toBe(true);
    expect(oauthPasswordSetupCopy(u).toLowerCase()).not.toContain("não possui senha");
    expect(oauthPasswordSetupCopy(u).toLowerCase()).not.toContain("ainda não");
  });

  it("['apple'] → capability UNKNOWN; pode definir senha", () => {
    const u = user({ providers: ["apple"], identities: ["apple"] });
    expect(resolvePasswordSetupUX(u)).toBe("can_define_password");
    expect(oauthPasswordSetupCopy(u)).toMatch(/apple/i);
  });

  it("[] → conservador", () => {
    expect(resolvePasswordSetupUX(user({ providers: [], identities: [] }))).toBe("unknown");
    expect(canDefinePasswordForCurrentIdentity(null)).toBe(false);
  });

  it("não infere autoridade a partir do provider", () => {
    const u = user({ providers: ["google"] });
    expect(JSON.stringify(u)).not.toMatch(/role|clinic|patient|professional|admin/i);
    expect(resolvePasswordSetupUX(u)).toBe("can_define_password");
  });
});
