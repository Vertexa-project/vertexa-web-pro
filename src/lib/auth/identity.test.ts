import { describe, expect, it } from "vitest";

import type { CurrentProfessional } from "@/lib/api/profile";
import { resolveIdentity } from "./identity";

const professional: CurrentProfessional = {
  id: "prof-1",
  profileId: "pf-1",
  clinicId: "clinic-1",
  fullName: "Dra. Helena Braga",
  type: "nutritionist",
  profileRole: "professional",
};

const session = { userId: "auth-1", email: "helena@clinica.com" };

describe("resolveIdentity — só autenticação real (nunca demo)", () => {
  it("loading enquanto a sessão/profile ainda resolvem", () => {
    expect(
      resolveIdentity({ loading: true, session: null, profileId: null, professional: null }),
    ).toEqual({
      status: "loading",
      professional: null,
      actingProfileId: null,
      email: null,
      displayName: null,
    });
  });

  it("anonymous sem sessão", () => {
    expect(
      resolveIdentity({ loading: false, session: null, profileId: null, professional: null }),
    ).toMatchObject({ status: "anonymous" });
  });

  it("active com professional + profile", () => {
    const out = resolveIdentity({
      loading: false,
      session,
      profileId: "pf-1",
      professional,
    });
    expect(out.status).toBe("active");
    expect(out.actingProfileId).toBe("pf-1");
    expect(out.displayName).toBe("Dra. Helena Braga");
    expect(out.email).toBe("helena@clinica.com");
    expect(out.professional).toBe(professional);
  });

  it("pending com sessão sem professional/clinic", () => {
    const out = resolveIdentity({
      loading: false,
      session,
      profileId: "pf-pending",
      professional: null,
    });
    expect(out.status).toBe("pending");
    expect(out.actingProfileId).toBe("pf-pending");
    expect(out.professional).toBeNull();
  });
});
