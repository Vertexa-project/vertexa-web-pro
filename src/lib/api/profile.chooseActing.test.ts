import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { chooseActingProfessional, type CurrentProfessional } from "./profile";

const row = (id: string, clinicId: string): CurrentProfessional => ({
  id, profileId: "p", clinicId, fullName: null, type: "educador_fisico" as CurrentProfessional["type"], profileRole: null,
});

describe("chooseActingProfessional (identidade em paralelo)", () => {
  it("sem linhas não há profissional", () => {
    expect(chooseActingProfessional([], [])).toBeNull();
  });
  it("memberships com erro: uma linha vale; várias usam a escolha sem memberships", () => {
    expect(chooseActingProfessional([row("a", "c1")], undefined)?.id).toBe("a");
    expect(chooseActingProfessional([row("a", "c1"), row("b", "c2")], undefined)).not.toBeNull();
  });
  it("escolhe a linha da clínica operacional onde está ativo", () => {
    const m = [
      { clinicId: "c1", clinicName: "A", status: "deactivated", clinicStatus: "active" },
      { clinicId: "c2", clinicName: "B", status: "active", clinicStatus: "active" },
    ] as unknown as Parameters<typeof chooseActingProfessional>[1];
    expect(chooseActingProfessional([row("a", "c1"), row("b", "c2")], m)?.id).toBe("b");
  });
});
