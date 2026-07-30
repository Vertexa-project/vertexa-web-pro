import { describe, expect, it } from "vitest";

import {
  changedByLabel,
  deactivatedClinics,
  isActiveProfessionalStatus,
  isExpectedMemberStatusError,
  latestStatusEventByProfessional,
  memberStatusErrorMessage,
  noActionExplanation,
  professionalStatusLabel,
  resolveClinicAccess,
  resolveMemberAction,
  sortTeamByStatus,
  summarizeTeamStatus,
} from "./professionalStatus";
import type { ClinicMembership, ProfessionalStatusEvent } from "@/lib/api/professionalStatus";

function ev(over: Partial<ProfessionalStatusEvent> = {}): ProfessionalStatusEvent {
  return {
    professionalId: "pr1",
    fromStatus: "active",
    toStatus: "inactive",
    reason: null,
    changedAt: "2026-07-30T10:00:00Z",
    changedByName: "Ana Prado",
    ...over,
  };
}

function member(over: Partial<{ status: string | null; fullName: string | null }> = {}) {
  return { status: "active" as string | null, fullName: "Zulmira" as string | null, ...over };
}

/** Erro no formato do PostgrestError (só o que a UI lê). */
function pgError(code: string, hint?: string) {
  return { code, hint: hint ?? null, message: "erro", details: null };
}

describe("isActiveProfessionalStatus — espelho EXATO do banco (null conta como ATIVO)", () => {
  it("'active' é ativo", () => expect(isActiveProfessionalStatus("active")).toBe(true));
  it("'inactive' não é ativo", () => expect(isActiveProfessionalStatus("inactive")).toBe(false));

  // coalesce(status,'active')='active' é o predicado dos 6 helpers. Tratar null como inativo
  // marcaria como desativado alguém que o banco considera ativo — e a tela mentiria ao contrário.
  it("null e undefined contam como ATIVO", () => {
    expect(isActiveProfessionalStatus(null)).toBe(true);
    expect(isActiveProfessionalStatus(undefined)).toBe(true);
  });

  it("qualquer outro valor não é ativo", () => {
    expect(isActiveProfessionalStatus("suspended")).toBe(false);
  });

  it("rótulo pt-BR acompanha", () => {
    expect(professionalStatusLabel(null)).toBe("Ativo");
    expect(professionalStatusLabel("inactive")).toBe("Inativo");
  });
});

describe("summarizeTeamStatus / sortTeamByStatus", () => {
  it("conta ativos e inativos tratando null como ativo", () => {
    expect(summarizeTeamStatus([member(), member({ status: null }), member({ status: "inactive" })]))
      .toEqual({ total: 3, active: 2, inactive: 1 });
  });

  it("ATIVOS primeiro; dentro do grupo, por nome pt-BR", () => {
    const out = sortTeamByStatus([
      member({ fullName: "Zulmira", status: "active" }),
      member({ fullName: "Ávila", status: "inactive" }),
      member({ fullName: "Bruno", status: "active" }),
      member({ fullName: "Ana", status: "inactive" }),
    ]);
    expect(out.map((m) => m.fullName)).toEqual(["Bruno", "Zulmira", "Ana", "Ávila"]);
  });

  it("nome nulo não quebra a ordenação", () => {
    expect(() => sortTeamByStatus([member({ fullName: null }), member()])).not.toThrow();
  });
});

describe("latestStatusEventByProfessional — o último de cada pessoa, sem confiar na ordem", () => {
  it("escolhe o mais recente por changedAt, mesmo com a lista embaralhada", () => {
    const map = latestStatusEventByProfessional([
      ev({ professionalId: "a", changedAt: "2026-07-01T00:00:00Z", toStatus: "inactive" }),
      ev({ professionalId: "a", changedAt: "2026-07-20T00:00:00Z", toStatus: "active" }),
      ev({ professionalId: "a", changedAt: "2026-07-10T00:00:00Z", toStatus: "inactive" }),
      ev({ professionalId: "b", changedAt: "2026-07-05T00:00:00Z" }),
    ]);
    expect(map.get("a")?.changedAt).toBe("2026-07-20T00:00:00Z");
    expect(map.get("a")?.toStatus).toBe("active");
    expect(map.get("b")?.changedAt).toBe("2026-07-05T00:00:00Z");
  });

  it("lista ausente vira mapa vazio", () => {
    expect(latestStatusEventByProfessional(undefined).size).toBe(0);
    expect(latestStatusEventByProfessional(null).size).toBe(0);
  });

  // O autor é anulável (changed_by nulo, ou profile que o leitor não enxerga por can_see_profile).
  it("sem nome do autor, a linha não some: vira genérico", () => {
    expect(changedByLabel({ changedByName: null })).toBe("um administrador da clínica");
    expect(changedByLabel({ changedByName: "   " })).toBe("um administrador da clínica");
    expect(changedByLabel({ changedByName: "Ana Prado" })).toBe("Ana Prado");
  });
});

describe("resolveMemberAction — a MESMA ordem de recusa do servidor", () => {
  const base = { isClinicAdmin: true, isAdminLoading: false, isSelf: false, isOwner: false, status: "active" };

  it("carregando o sinal de admin ⇒ nenhum botão (fail-closed)", () => {
    expect(resolveMemberAction({ ...base, isAdminLoading: true })).toEqual({
      kind: "none",
      reason: "loading",
    });
  });

  it("não-admin ⇒ somente leitura", () => {
    expect(resolveMemberAction({ ...base, isClinicAdmin: false })).toEqual({
      kind: "none",
      reason: "not-admin",
    });
  });

  it("o DONO nunca tem botão", () => {
    expect(resolveMemberAction({ ...base, isOwner: true })).toEqual({ kind: "none", reason: "owner" });
  });

  // A ordem importa: o dono que TAMBÉM é o usuário logado tem de ouvir a razão da POSSE, que é a
  // que o servidor aplica primeiro — senão a tela explica a recusa errada.
  it("dono E si mesmo ⇒ a razão é a POSSE (é a que o servidor checa antes)", () => {
    expect(resolveMemberAction({ ...base, isOwner: true, isSelf: true })).toEqual({
      kind: "none",
      reason: "owner",
    });
  });

  it("o próprio usuário não tem botão para si", () => {
    expect(resolveMemberAction({ ...base, isSelf: true })).toEqual({ kind: "none", reason: "self" });
  });

  it("admin, alguém ativo ⇒ oferece DESATIVAR", () => {
    expect(resolveMemberAction(base)).toEqual({ kind: "deactivate" });
  });

  it("admin, alguém inativo ⇒ oferece REATIVAR", () => {
    expect(resolveMemberAction({ ...base, status: "inactive" })).toEqual({ kind: "reactivate" });
  });

  it("status nulo é ativo ⇒ oferece DESATIVAR", () => {
    expect(resolveMemberAction({ ...base, status: null })).toEqual({ kind: "deactivate" });
  });

  it("cada ausência de botão tem texto, menos 'carregando' (que não tem o que dizer ainda)", () => {
    expect(noActionExplanation("owner")).toContain("transfira a posse");
    expect(noActionExplanation("self")).toContain("próprio cadastro");
    expect(noActionExplanation("not-admin")).toContain("administrador");
    expect(noActionExplanation("loading")).toBeNull();
  });
});

describe("memberStatusErrorMessage — o hint distingue as DUAS recusas 42501", () => {
  it("dono ⇒ diz o que fazer (transferir a posse)", () => {
    expect(memberStatusErrorMessage(pgError("42501", "OWNER_CANNOT_BE_DEACTIVATED"))).toContain(
      "Transfira a posse",
    );
  });

  it("autodesativação ⇒ manda pedir a outro administrador", () => {
    expect(memberStatusErrorMessage(pgError("42501", "SELF_DEACTIVATION_NOT_ALLOWED"))).toContain(
      "outro administrador",
    );
  });

  it("42501 sem hint ⇒ falta de permissão", () => {
    expect(memberStatusErrorMessage(pgError("42501"))).toContain("administrador desta clínica");
  });

  it("22023 e P0002 têm mensagem própria", () => {
    expect(memberStatusErrorMessage(pgError("22023"))).toContain("Dados incompletos");
    expect(memberStatusErrorMessage(pgError("P0002"))).toContain("não existe mais");
  });

  it("erro desconhecido cai no genérico e NÃO é esperado (vai ao Sentry)", () => {
    expect(memberStatusErrorMessage(new Error("boom"))).toContain("Não foi possível concluir");
    expect(isExpectedMemberStatusError(new Error("boom"))).toBe(false);
    expect(isExpectedMemberStatusError(pgError("42501"))).toBe(true);
  });
});

describe("resolveClinicAccess — a decisão da tela que EXPLICA", () => {
  const c = (status: string, name = "Clínica Alfa"): ClinicMembership => ({
    clinicId: "c1",
    clinicName: name,
    status,
  });

  it("carregando", () => {
    expect(resolveClinicAccess({ memberships: undefined, isLoading: true, isError: false })).toBe(
      "loading",
    );
  });

  it("uma clínica ativa ⇒ o painel abre", () => {
    expect(
      resolveClinicAccess({ memberships: [c("active")], isLoading: false, isError: false }),
    ).toBe("ok");
  });

  it("status nulo/ausente conta como ativa (mesma regra do banco)", () => {
    expect(
      resolveClinicAccess({
        memberships: [{ clinicId: "c1", clinicName: "X", status: null as unknown as string }],
        isLoading: false,
        isError: false,
      }),
    ).toBe("ok");
  });

  it("TODAS inativas ⇒ foi desativado", () => {
    expect(
      resolveClinicAccess({
        memberships: [c("inactive"), c("inactive", "Clínica Beta")],
        isLoading: false,
        isError: false,
      }),
    ).toBe("deactivated");
  });

  it("uma inativa e outra ATIVA ⇒ ainda abre (ele trabalha na outra)", () => {
    expect(
      resolveClinicAccess({
        memberships: [c("inactive"), c("active", "Clínica Beta")],
        isLoading: false,
        isError: false,
      }),
    ).toBe("ok");
  });

  it("nenhuma clínica ⇒ estado próprio, DIFERENTE de desativado", () => {
    expect(resolveClinicAccess({ memberships: [], isLoading: false, isError: false })).toBe(
      "no-clinic",
    );
  });

  // FAIL-OPEN deliberado: esta tela é explicação, não portão. Trancar por falha de rede
  // deixaria gente ATIVA do lado de fora — trocaria uma explicação por um incidente.
  it("erro ⇒ 'unknown' (o painel abre; o portão é a RLS, não esta tela)", () => {
    expect(resolveClinicAccess({ memberships: undefined, isLoading: false, isError: true })).toBe(
      "unknown",
    );
  });

  it("sem dado e sem erro também é 'unknown'", () => {
    expect(resolveClinicAccess({ memberships: undefined, isLoading: false, isError: false })).toBe(
      "unknown",
    );
  });

  it("deactivatedClinics devolve só as inativas, que é o que a tela nomeia", () => {
    const out = deactivatedClinics([c("active"), c("inactive", "Clínica Beta")]);
    expect(out.map((m) => m.clinicName)).toEqual(["Clínica Beta"]);
    expect(deactivatedClinics(undefined)).toEqual([]);
  });
});
