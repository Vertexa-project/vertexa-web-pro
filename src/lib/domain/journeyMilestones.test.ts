import { describe, expect, it } from "vitest";

import { computeMilestones, pickRelevantMilestone, type Milestone } from "./journeyMilestones";

const find = (ms: Milestone[], key: string) => ms.find((m) => m.key === key);

describe("computeMilestones — caso típico (start há 30 dias)", () => {
  const ms = computeMilestones({ startDate: "2026-06-20", birthDate: "1990-03-10", today: "2026-07-20" });

  it("chaves canônicas batem com a RPC (start / day_<offset> / birthday:YYYY)", () => {
    // J1: 10/mar já passou em 2026 (hoje é 20/jul) ⇒ próxima ocorrência = 2027 ⇒ birthday:2027.
    expect(ms.map((m) => m.key).sort()).toEqual(
      ["birthday:2027", "day_30", "day_60", "day_90", "start"].sort(),
    );
  });

  it("início ficou no passado (30 dias atrás)", () => {
    const start = find(ms, "start")!;
    expect(start.date).toBe("2026-06-20");
    expect(start.daysUntil).toBe(-30);
    expect(start.status).toBe("past");
  });

  it("day_30 cai EXATAMENTE hoje ⇒ upcoming (dentro da janela)", () => {
    const d30 = find(ms, "day_30")!;
    expect(d30.date).toBe("2026-07-20");
    expect(d30.daysUntil).toBe(0);
    expect(d30.status).toBe("upcoming");
    expect(d30.offsetDays).toBe(30);
  });

  it("day_60 e day_90 são futuros distantes com a data exata", () => {
    expect(find(ms, "day_60")).toMatchObject({ date: "2026-08-19", daysUntil: 30, status: "future" });
    expect(find(ms, "day_90")).toMatchObject({ date: "2026-09-18", daysUntil: 60, status: "future" });
  });
});

describe("computeMilestones — birth_date nula", () => {
  it("simplesmente NÃO gera marco de aniversário (sem erro)", () => {
    const ms = computeMilestones({ startDate: "2026-06-20", birthDate: null, today: "2026-07-20" });
    expect(ms.some((m) => m.kind === "birthday")).toBe(false);
    expect(find(ms, "start")).toBeTruthy();
  });
});

describe("computeMilestones — start_date nula", () => {
  it("sem início e sem offsets; só o aniversário (se houver)", () => {
    const ms = computeMilestones({ startDate: null, birthDate: "1990-08-01", today: "2026-07-20" });
    expect(ms.map((m) => m.key)).toEqual(["birthday:2026"]);
  });
});

describe("computeMilestones — aniversário = PRÓXIMA ocorrência (J1)", () => {
  it("aniversário AMANHÃ ⇒ upcoming (ocorrência deste ano)", () => {
    const ms = computeMilestones({ startDate: null, birthDate: "1985-07-21", today: "2026-07-20" });
    expect(find(ms, "birthday:2026")).toMatchObject({ date: "2026-07-21", daysUntil: 1, status: "upcoming" });
  });

  it("aniversário HOJE ⇒ ocorrência de HOJE (daysUntil 0; NÃO pula p/ o ano seguinte)", () => {
    const ms = computeMilestones({ startDate: null, birthDate: "1985-07-20", today: "2026-07-20" });
    expect(find(ms, "birthday:2026")).toMatchObject({ date: "2026-07-20", daysUntil: 0, status: "upcoming" });
  });

  it("3/jan com hoje 28/dez ⇒ upcoming ATRAVESSANDO o ano (fim do ponto cego da virada)", () => {
    const ms = computeMilestones({ startDate: null, birthDate: "1990-01-03", today: "2026-12-28" });
    const b = find(ms, "birthday:2027")!; // ocorrência = ANO SEGUINTE (chave estável no ano da ocorrência)
    expect(b.date).toBe("2027-01-03");
    expect(b.daysUntil).toBe(6);
    expect(b.status).toBe("upcoming");
  });

  it("aniversário ONTEM ⇒ próxima ocorrência = ANO SEGUINTE, fora da janela (future)", () => {
    const ms = computeMilestones({ startDate: null, birthDate: "1985-07-19", today: "2026-07-20" });
    const b = find(ms, "birthday:2027")!;
    expect(b.date).toBe("2027-07-19");
    expect(b.status).toBe("future");
    expect(b.daysUntil).toBeGreaterThan(7);
  });

  it("dentro da janela: 5 dias ⇒ upcoming; 8 dias ⇒ future (fronteira; ocorrência deste ano)", () => {
    const soon = computeMilestones({ startDate: null, birthDate: "1985-07-25", today: "2026-07-20" });
    expect(find(soon, "birthday:2026")).toMatchObject({ daysUntil: 5, status: "upcoming" });
    const far = computeMilestones({ startDate: null, birthDate: "1985-07-28", today: "2026-07-20" });
    expect(find(far, "birthday:2026")).toMatchObject({ daysUntil: 8, status: "future" });
  });

  it("marco EXATAMENTE na fronteira (+7 dias) ainda é upcoming", () => {
    const edge = computeMilestones({ startDate: null, birthDate: "1985-07-27", today: "2026-07-20" });
    expect(find(edge, "birthday:2026")).toMatchObject({ daysUntil: 7, status: "upcoming" });
  });
});

describe("computeMilestones — 29/02 (regra adotada: 28/02 em ano comum)", () => {
  it("ano NÃO-bissexto, ainda por vir: 29/02 → 28/02 (ocorrência deste ano)", () => {
    const ms = computeMilestones({ startDate: null, birthDate: "2000-02-29", today: "2026-02-15" });
    expect(find(ms, "birthday:2026")!.date).toBe("2026-02-28");
  });

  it("ano bissexto: mantém 29/02", () => {
    const ms = computeMilestones({ startDate: null, birthDate: "2000-02-29", today: "2028-02-15" });
    expect(find(ms, "birthday:2028")!.date).toBe("2028-02-29");
  });

  it("ano NÃO-bissexto, já passou 28/02 ⇒ próxima ocorrência no ano seguinte (clampada se comum)", () => {
    const ms = computeMilestones({ startDate: null, birthDate: "2000-02-29", today: "2026-03-01" });
    expect(find(ms, "birthday:2027")!.date).toBe("2027-02-28"); // 2027 é comum ⇒ 28/02
  });
});

describe("computeMilestones — offsets injetáveis (extensibilidade futura)", () => {
  it("respeita offsets custom (ex.: {30,60,90,180,365})", () => {
    const ms = computeMilestones({
      startDate: "2026-01-01",
      birthDate: null,
      today: "2026-07-20",
      offsets: [30, 60, 90, 180, 365],
    });
    expect(ms.map((m) => m.key)).toEqual(["start", "day_30", "day_60", "day_90", "day_180", "day_365"]);
    expect(find(ms, "day_365")!.date).toBe("2027-01-01");
  });
});

describe("pickRelevantMilestone", () => {
  it("prioriza o upcoming mais cedo", () => {
    const ms = computeMilestones({ startDate: "2026-06-25", birthDate: "1990-08-15", today: "2026-07-20" });
    // day_30 = 2026-07-25 (em 5 dias, upcoming) deve vencer o aniversário (em 26 dias, future).
    const rel = pickRelevantMilestone(ms)!;
    expect(rel.key).toBe("day_30");
    expect(rel.status).toBe("upcoming");
  });

  it("sem upcoming: escolhe o futuro mais próximo", () => {
    const ms = computeMilestones({ startDate: "2026-07-15", birthDate: null, today: "2026-07-20" });
    // start (past), day_30=08-14 (future +25), day_60, day_90 → o mais próximo é day_30.
    expect(pickRelevantMilestone(ms)!.key).toBe("day_30");
  });

  it("só passados: escolhe o mais recente", () => {
    const ms = computeMilestones({ startDate: "2025-01-01", birthDate: null, today: "2026-07-20" });
    // start, day_30, day_60, day_90 todos no passado → o mais recente é day_90 (2025-04-01).
    expect(pickRelevantMilestone(ms)!.key).toBe("day_90");
  });

  it("lista vazia ⇒ null (paciente sem start_date e sem birth_date)", () => {
    const ms = computeMilestones({ startDate: null, birthDate: null, today: "2026-07-20" });
    expect(ms).toEqual([]);
    expect(pickRelevantMilestone(ms)).toBeNull();
  });
});
