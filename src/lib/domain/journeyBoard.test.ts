import { describe, expect, it } from "vitest";

import {
  applyMove,
  groupPatientsByColumn,
  initialColumnId,
  resolvePatientColumn,
  sortColumns,
  type JourneyColumn,
  type JourneyStateMap,
} from "./journeyBoard";

const col = (id: string, position: number, is_initial = false, name = id): JourneyColumn => ({
  id,
  clinic_id: "clinic-1",
  name,
  position,
  color: null,
  is_initial,
  created_at: "2026-07-01T00:00:00Z",
});

// Colunas fora de ordem de propósito (o quadro deve ordenar por position).
const columns = [col("c3", 3), col("c1", 1, true, "Novos"), col("c2", 2)];

describe("sortColumns — ordena por position", () => {
  it("respeita a ordem/posição definidas", () => {
    expect(sortColumns(columns).map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });
});

describe("initialColumnId — coluna inicial", () => {
  it("retorna a coluna is_initial", () => {
    expect(initialColumnId(columns)).toBe("c1");
  });
  it("fallback defensivo: sem is_initial, a primeira por posição", () => {
    expect(initialColumnId([col("z", 5), col("a", 2)])).toBe("a");
  });
  it("sem colunas ⇒ null", () => {
    expect(initialColumnId([])).toBeNull();
  });
});

describe("resolvePatientColumn — paciente SEM estado deriva para a inicial", () => {
  const state: JourneyStateMap = { p1: "c2" };
  it("com estado gravado usa a coluna do estado", () => {
    expect(resolvePatientColumn("p1", state, columns)).toBe("c2");
  });
  it("SEM estado deriva para a coluna inicial (não gravado)", () => {
    expect(resolvePatientColumn("p_novo", state, columns)).toBe("c1");
  });
});

describe("applyMove — reducer OTIMISTA imutável (base da reversão)", () => {
  it("gera novo mapa com o paciente na coluna destino", () => {
    const before: JourneyStateMap = { p1: "c1" };
    const after = applyMove(before, "p1", "c2");
    expect(after.p1).toBe("c2");
  });
  it("NÃO muta o snapshot anterior — a reversão restaura o estado original", () => {
    const snapshot: JourneyStateMap = { p1: "c1", p2: "c3" };
    const optimistic = applyMove(snapshot, "p1", "c2");
    // O snapshot permanece intacto → o onError do hook restaura exatamente isto.
    expect(snapshot).toEqual({ p1: "c1", p2: "c3" });
    expect(optimistic).not.toBe(snapshot);
    // Simula a reversão: voltar ao snapshot recoloca p1 na coluna original.
    expect(snapshot.p1).toBe("c1");
  });
});

describe("groupPatientsByColumn — agrupa na ordem, derivando sem-estado p/ inicial", () => {
  const patients = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
  const state: JourneyStateMap = { p1: "c2", p2: "c3" }; // p3 sem estado

  it("cada paciente cai na coluna certa; p3 (sem estado) na inicial c1", () => {
    const groups = groupPatientsByColumn(patients, state, columns);
    expect(groups.map((g) => g.column.id)).toEqual(["c1", "c2", "c3"]); // ordem
    const byId = Object.fromEntries(groups.map((g) => [g.column.id, g.patients.map((p) => p.id)]));
    expect(byId).toEqual({ c1: ["p3"], c2: ["p1"], c3: ["p2"] });
  });

  it("contadores por coluna refletem o agrupamento", () => {
    const groups = groupPatientsByColumn(patients, state, columns);
    expect(groups.map((g) => g.patients.length)).toEqual([1, 1, 1]);
  });

  it("estado apontando p/ coluna fora da visão cai na inicial (fail-safe)", () => {
    const groups = groupPatientsByColumn([{ id: "px" }], { px: "coluna-invisivel" }, columns);
    const c1 = groups.find((g) => g.column.id === "c1")!;
    expect(c1.patients.map((p) => p.id)).toEqual(["px"]);
  });
});
