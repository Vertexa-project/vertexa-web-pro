import { describe, expect, it } from "vitest";

import {
  activeProfessionalsFromLinks,
  canManagePatientTeam,
  changedByLabel,
  isActiveLinkStatus,
  isExpectedLinkActionError,
  linkActionErrorCode,
  linkActionErrorMessage,
  linkStatusLabel,
  onlyActiveMembers,
  patientsWithoutProfessionalIds,
  sortPatientTeam,
  summarizePatientTeam,
} from "./patientTeam";
import type { PatientTeamMember } from "@/lib/api/patientTeam";

function member(over: Partial<PatientTeamMember> = {}): PatientTeamMember {
  return {
    linkId: "l1",
    professionalId: "p1",
    type: "nutritionist",
    fullName: "Ana Prado",
    isExternal: false,
    status: "active",
    statusChangedAt: null,
    statusChangedByName: null,
    statusReason: null,
    ...over,
  };
}

describe("isActiveLinkStatus — espelho de coalesce(status,'active')='active'", () => {
  it("trata 'active' como ativo", () => {
    expect(isActiveLinkStatus("active")).toBe(true);
  });

  // A regra que mais fácil se erra: a coluna é text livre SEM CHECK, e o banco resolve null
  // como 'active'. Tratar null como inativo esconderia responsável de verdade.
  it("trata NULL como ATIVO (é o que o banco faz)", () => {
    expect(isActiveLinkStatus(null)).toBe(true);
    expect(isActiveLinkStatus(undefined)).toBe(true);
  });

  it("trata 'inactive' como inativo", () => {
    expect(isActiveLinkStatus("inactive")).toBe(false);
  });

  // Qualquer outra string também não é 'active' — fail-closed em relação ao acesso: se o banco
  // não daria acesso, a UI não pode afirmar que dá.
  it("trata qualquer outro valor como inativo", () => {
    expect(isActiveLinkStatus("suspended")).toBe(false);
    expect(isActiveLinkStatus("")).toBe(false);
    expect(isActiveLinkStatus("ACTIVE")).toBe(false);
  });
});

describe("linkStatusLabel", () => {
  it("rotula ativo e inativo em pt-BR", () => {
    expect(linkStatusLabel("active")).toBe("Ativo");
    expect(linkStatusLabel(null)).toBe("Ativo");
    expect(linkStatusLabel("inactive")).toBe("Inativo");
    expect(linkStatusLabel("qualquer-coisa")).toBe("Inativo");
  });
});

describe("onlyActiveMembers — o filtro da leitura corrida", () => {
  it("mantém ativos e null, remove inativos", () => {
    const rows = [
      member({ linkId: "a", status: "active" }),
      member({ linkId: "b", status: null }),
      member({ linkId: "c", status: "inactive" }),
    ];
    expect(onlyActiveMembers(rows).map((m) => m.linkId)).toEqual(["a", "b"]);
  });

  it("devolve lista vazia quando todos estão inativos (é o caso 'sem responsável')", () => {
    expect(onlyActiveMembers([member({ status: "inactive" })])).toEqual([]);
  });

  it("não muta a lista recebida", () => {
    const rows = [member({ status: "inactive" })];
    onlyActiveMembers(rows);
    expect(rows).toHaveLength(1);
  });
});

// Este é o filtro REAL usado por listPatients/getPatient (lib/api/patients.ts chama esta função).
// É o companheiro obrigatório do WP: sem ele, um profissional DESATIVADO — que o banco já não
// deixa mais ler nada da paciente — continuaria estampado como "responsável" na listagem e no
// header do perfil, porque a linha do vínculo é preservada de propósito.
describe("activeProfessionalsFromLinks — o filtro da listagem e do header", () => {
  const link = (status: string | null, id: string | null) => ({
    status,
    professionals: id ? { id } : null,
  });

  it("devolve só os profissionais de vínculo ativo", () => {
    const out = activeProfessionalsFromLinks([
      link("active", "a"),
      link("inactive", "b"),
      link(null, "c"),
    ]);
    expect(out.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("descarta o desativado mesmo sendo o único vínculo (paciente fica sem responsável)", () => {
    expect(activeProfessionalsFromLinks([link("inactive", "a")])).toEqual([]);
  });

  it("descarta professionals nulo (vínculo cujo profissional a RLS não devolve)", () => {
    expect(activeProfessionalsFromLinks([link("active", null)])).toEqual([]);
  });

  it("aceita null/undefined (paciente sem nenhum vínculo)", () => {
    expect(activeProfessionalsFromLinks(null)).toEqual([]);
    expect(activeProfessionalsFromLinks(undefined)).toEqual([]);
  });

  it("preserva a ordem de chegada dos ativos", () => {
    const out = activeProfessionalsFromLinks([link("active", "z"), link("active", "a")]);
    expect(out.map((p) => p.id)).toEqual(["z", "a"]);
  });
});

describe("canManagePatientTeam — a regra 'sem botão para não-admin'", () => {
  it("admin com sinal resolvido PODE gerenciar", () => {
    expect(canManagePatientTeam({ isClinicAdmin: true, isLoading: false })).toBe(true);
  });

  it("não-admin NÃO pode", () => {
    expect(canManagePatientTeam({ isClinicAdmin: false, isLoading: false })).toBe(false);
  });

  // FAIL-CLOSED: enquanto carrega a resposta é NÃO. Um botão exibido no escuro seria um botão
  // que a RPC recusa com 42501 — e ação destrutiva não pode descobrir permissão pelo erro.
  it("é FAIL-CLOSED enquanto o sinal de admin carrega, mesmo que o valor otimista seja true", () => {
    expect(canManagePatientTeam({ isClinicAdmin: true, isLoading: true })).toBe(false);
    expect(canManagePatientTeam({ isClinicAdmin: false, isLoading: true })).toBe(false);
  });
});

describe("sortPatientTeam", () => {
  it("põe ativos antes de inativos", () => {
    const rows = [
      member({ linkId: "i", fullName: "Ana", status: "inactive" }),
      member({ linkId: "a", fullName: "Bruno", status: "active" }),
    ];
    expect(sortPatientTeam(rows).map((m) => m.linkId)).toEqual(["a", "i"]);
  });

  it("dentro do grupo, ordena por nome respeitando acento pt-BR", () => {
    const rows = [
      member({ linkId: "3", fullName: "Zoe" }),
      member({ linkId: "1", fullName: "Ábia" }),
      member({ linkId: "2", fullName: "Bruno" }),
    ];
    expect(sortPatientTeam(rows).map((m) => m.linkId)).toEqual(["1", "2", "3"]);
  });

  it("aceita nome nulo sem quebrar", () => {
    const rows = [member({ linkId: "x", fullName: null }), member({ linkId: "y", fullName: "Ana" })];
    expect(sortPatientTeam(rows).map((m) => m.linkId)).toEqual(["x", "y"]);
  });

  it("não muta a lista recebida", () => {
    const rows = [member({ linkId: "b", fullName: "B" }), member({ linkId: "a", fullName: "A" })];
    sortPatientTeam(rows);
    expect(rows.map((m) => m.linkId)).toEqual(["b", "a"]);
  });
});

describe("summarizePatientTeam", () => {
  it("conta ativos e inativos (null conta como ativo)", () => {
    const rows = [
      member({ status: "active" }),
      member({ status: null }),
      member({ status: "inactive" }),
      member({ status: "inactive" }),
    ];
    expect(summarizePatientTeam(rows)).toEqual({ total: 4, active: 2, inactive: 2 });
  });

  it("lista vazia zera tudo", () => {
    expect(summarizePatientTeam([])).toEqual({ total: 0, active: 0, inactive: 0 });
  });
});

describe("changedByLabel", () => {
  it("usa o nome quando existe", () => {
    expect(changedByLabel({ statusChangedByName: "Ana Prado" })).toBe("Ana Prado");
  });

  // O carimbo é anulável: vínculo nunca desativado, ou profile que o leitor não enxerga.
  it("cai para '—' quando o nome falta ou é só espaço", () => {
    expect(changedByLabel({ statusChangedByName: null })).toBe("—");
    expect(changedByLabel({ statusChangedByName: "   " })).toBe("—");
  });
});

describe("erros das RPCs de vínculo", () => {
  it("extrai o SQLSTATE de um PostgrestError", () => {
    expect(linkActionErrorCode({ code: "42501" })).toBe("42501");
  });

  it("devolve null quando não há código utilizável", () => {
    expect(linkActionErrorCode(new Error("boom"))).toBeNull();
    expect(linkActionErrorCode(null)).toBeNull();
    expect(linkActionErrorCode({ code: 42501 })).toBeNull();
  });

  it("classifica 42501/22023/P0002 como ESPERADOS (não vão ao Sentry)", () => {
    expect(isExpectedLinkActionError({ code: "42501" })).toBe(true);
    expect(isExpectedLinkActionError({ code: "22023" })).toBe(true);
    expect(isExpectedLinkActionError({ code: "P0002" })).toBe(true);
  });

  it("um erro desconhecido NÃO é esperado (vira incidente)", () => {
    expect(isExpectedLinkActionError({ code: "08006" })).toBe(false);
    expect(isExpectedLinkActionError(new Error("rede"))).toBe(false);
  });

  it("traduz cada código para uma mensagem própria, sem vazar erro cru", () => {
    expect(linkActionErrorMessage({ code: "42501" })).toMatch(/administrador da clínica/i);
    expect(linkActionErrorMessage({ code: "22023" })).toMatch(/incompletos/i);
    expect(linkActionErrorMessage({ code: "P0002" })).toMatch(/não existe mais/i);
    expect(linkActionErrorMessage(new Error("connection refused"))).not.toMatch(/connection/i);
  });
});

describe("patientsWithoutProfessionalIds", () => {
  it("vira um Set de patientId", () => {
    const set = patientsWithoutProfessionalIds([
      { patientId: "p1", fullName: "Mariana", since: null },
      { patientId: "p2", fullName: null, since: "2026-07-29T00:00:00Z" },
    ]);
    expect(set.has("p1")).toBe(true);
    expect(set.has("p2")).toBe(true);
    expect(set.has("p3")).toBe(false);
  });

  // A RPC não roda para não-admin (a query fica desabilitada) — undefined tem de virar
  // "nenhum badge", nunca um erro.
  it("undefined vira conjunto vazio (não-admin: badge simplesmente não aparece)", () => {
    expect(patientsWithoutProfessionalIds(undefined).size).toBe(0);
    expect(patientsWithoutProfessionalIds([]).size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// WP-FRONT-2bii-A item 4 — O BADGE "SEM RESPONSÁVEL ATIVO" REFLETE A CASCATA SOZINHO.
//
// VERIFICAÇÃO, não reimplementação: a cascata do WP-TEAM-2b-ii não inventa estado novo — ela põe
// os vínculos do desativado em 'inactive' (com o motivo prefixado por [DESATIVACAO_DO_PROFISSIONAL]).
// Como a listagem já filtra por status do VÍNCULO, e a RPC patients_without_active_professional
// usa o MESMO critério do banco, nada precisa mudar no front. Estes testes existem para que essa
// propriedade não regrida em silêncio no dia em que alguém "simplificar" o filtro.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("cascata da desativação do PROFISSIONAL — o badge sai de graça", () => {
  it("vínculo derrubado pela cascata é descartado como qualquer outro inativo", () => {
    // Exatamente a linha que a cascata grava: status inactive + motivo com o prefixo de causa.
    const links = [
      { status: "inactive", professionals: { id: "quem-saiu" } },
      { status: "inactive", professionals: { id: "outro-que-saiu" } },
    ];
    expect(activeProfessionalsFromLinks(links)).toEqual([]);
  });

  it("a paciente que só tinha o desativado fica SEM responsável (é o badge)", () => {
    const antes = activeProfessionalsFromLinks([{ status: "active", professionals: { id: "a1" } }]);
    const depois = activeProfessionalsFromLinks([{ status: "inactive", professionals: { id: "a1" } }]);
    expect(antes).toHaveLength(1);
    expect(depois).toHaveLength(0);
  });

  it("quem tinha DOIS responsáveis continua com o que sobrou (não vira 'sem responsável')", () => {
    const out = activeProfessionalsFromLinks([
      { status: "inactive", professionals: { id: "saiu" } },
      { status: "active", professionals: { id: "ficou" } },
    ]);
    expect(out).toEqual([{ id: "ficou" }]);
  });

  it("o conjunto do badge vem da RPC por clínica, não de dedução da listagem", () => {
    const ids = patientsWithoutProfessionalIds([
      { patientId: "p1", fullName: "A", since: null },
      { patientId: "p2", fullName: "B", since: null },
    ]);
    expect(ids.has("p1")).toBe(true);
    expect(ids.has("p3")).toBe(false);
    expect(patientsWithoutProfessionalIds(undefined).size).toBe(0);
  });
});
