import { describe, expect, it } from "vitest";

import type { ClinicJoinRequest } from "@/lib/api/clinicJoin";
import type { ProfessionalWithDisciplines } from "@/lib/api/disciplines";
import {
  decisionErrorCode,
  decisionErrorMessage,
  isExpectedDecisionError,
  onlyPending,
  requesterLabel,
  resolveTeamAccess,
  sortPendingFirstIn,
  summarizeTeam,
} from "./teamManagement";

const pgError = (code: string) => ({ code, message: "x", details: "", hint: "" });

const req = (over: Partial<ClinicJoinRequest> = {}): ClinicJoinRequest => ({
  id: "r1",
  profileId: "p1",
  clinicId: "c1",
  status: "pending",
  createdAt: "2026-07-20T10:00:00Z",
  decidedAt: null,
  requesterName: "Ana Prado",
  requesterEmail: "ana@clinica.test",
  ...over,
});

const prof = (over: Partial<ProfessionalWithDisciplines> = {}): ProfessionalWithDisciplines => ({
  professionalId: "pr1",
  // profile_id passou a vir na consulta (WP-FRONT-2bii-A): é como a tela sabe quem é o DONO.
  profileId: "pf1",
  fullName: "Ana Prado",
  type: "doctor",
  disciplines: ["medicina"],
  ...over,
});

describe("classificação de erro das decisões", () => {
  it("extrai o SQLSTATE", () => {
    expect(decisionErrorCode(pgError("42501"))).toBe("42501");
    expect(decisionErrorCode(new Error("boom"))).toBeNull();
    expect(decisionErrorCode(null)).toBeNull();
    expect(decisionErrorCode({ code: 42501 })).toBeNull(); // código não-string não conta
  });

  it("trata 42501/22023/P0002 como esperados (não vão ao Sentry)", () => {
    expect(isExpectedDecisionError(pgError("42501"))).toBe(true);
    expect(isExpectedDecisionError(pgError("22023"))).toBe(true);
    expect(isExpectedDecisionError(pgError("P0002"))).toBe(true);
    expect(isExpectedDecisionError(pgError("XX000"))).toBe(false);
    expect(isExpectedDecisionError(new Error("boom"))).toBe(false);
  });
});

describe("decisionErrorMessage", () => {
  it("explica a falta de permissão de admin", () => {
    expect(decisionErrorMessage(pgError("42501"))).toMatch(/administrador/i);
  });

  it("explica que outra pessoa já respondeu", () => {
    expect(decisionErrorMessage(pgError("22023"))).toMatch(/já foi respondida/i);
  });

  it("explica que o pedido sumiu", () => {
    expect(decisionErrorMessage(pgError("P0002"))).toMatch(/não existe mais/i);
  });

  it("tem fallback genérico que NÃO vaza o erro cru", () => {
    const msg = decisionErrorMessage(new Error("connection refused at 10.0.0.1"));
    expect(msg).not.toMatch(/10\.0\.0\.1|connection refused/);
    expect(msg).toMatch(/Tente novamente/i);
  });
});

describe("fila de pedidos", () => {
  it("ordena o MAIS ANTIGO primeiro (é fila, não feed)", () => {
    const ordered = sortPendingFirstIn([
      req({ id: "novo", createdAt: "2026-07-25T10:00:00Z" }),
      req({ id: "velho", createdAt: "2026-07-01T10:00:00Z" }),
      req({ id: "meio", createdAt: "2026-07-10T10:00:00Z" }),
    ]);
    expect(ordered.map((r) => r.id)).toEqual(["velho", "meio", "novo"]);
  });

  it("não muta o array recebido", () => {
    const input = [req({ id: "b", createdAt: "2026-07-25T10:00:00Z" }), req({ id: "a", createdAt: "2026-07-01T10:00:00Z" })];
    sortPendingFirstIn(input);
    expect(input.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("filtra só os pendentes", () => {
    const list = [
      req({ id: "1", status: "pending" }),
      req({ id: "2", status: "approved" }),
      req({ id: "3", status: "rejected" }),
      req({ id: "4", status: "cancelled" }),
    ];
    expect(onlyPending(list).map((r) => r.id)).toEqual(["1"]);
  });

  it("lista vazia continua vazia", () => {
    expect(onlyPending([])).toEqual([]);
    expect(sortPendingFirstIn([])).toEqual([]);
  });
});

describe("requesterLabel", () => {
  it("prefere o nome", () => {
    expect(requesterLabel(req())).toBe("Ana Prado");
  });

  it("cai para o e-mail quando não há nome", () => {
    expect(requesterLabel(req({ requesterName: null }))).toBe("ana@clinica.test");
    expect(requesterLabel(req({ requesterName: "   " }))).toBe("ana@clinica.test");
  });

  it("cai para genérico quando não há nada (pedido anterior ao snapshot)", () => {
    expect(requesterLabel(req({ requesterName: null, requesterEmail: null }))).toBe("Profissional");
  });
});

describe("resolveTeamAccess — fail-closed", () => {
  it("carregando NÃO é permitido (não abre a área no escuro)", () => {
    expect(resolveTeamAccess({ isClinicAdmin: false, isLoading: true })).toBe("loading");
    // mesmo com o sinal já true, enquanto carrega o estado é 'loading', nunca 'allowed'
    expect(resolveTeamAccess({ isClinicAdmin: true, isLoading: true })).toBe("loading");
  });

  it("admin resolvido libera", () => {
    expect(resolveTeamAccess({ isClinicAdmin: true, isLoading: false })).toBe("allowed");
  });

  it("não-admin resolvido nega", () => {
    expect(resolveTeamAccess({ isClinicAdmin: false, isLoading: false })).toBe("denied");
  });
});

describe("summarizeTeam", () => {
  it("conta o total e quem está sem disciplina", () => {
    const s = summarizeTeam([
      prof({ professionalId: "a", disciplines: ["medicina"] }),
      prof({ professionalId: "b", disciplines: [] }),
      prof({ professionalId: "c", disciplines: [] }),
      prof({ professionalId: "d", disciplines: ["nutricao", "educacao_fisica"] }),
    ]);
    expect(s).toEqual({ total: 4, withoutDiscipline: 2 });
  });

  it("equipe vazia", () => {
    expect(summarizeTeam([])).toEqual({ total: 0, withoutDiscipline: 0 });
  });
});
