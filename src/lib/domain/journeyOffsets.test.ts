import { describe, expect, it } from "vitest";

import { JOURNEY_DAY_OFFSETS } from "./journeyOffsets";

// Espelho TRAVADO da constante do banco private.journey_day_offsets() (migration 20260730090000).
// Se o banco mudar {30,60,90}, este teste falha até o espelho ser atualizado (e vice-versa) — o
// mesmo contrato de segurança do mapa de disciplinas.
describe("JOURNEY_DAY_OFFSETS — espelho do banco (private.journey_day_offsets)", () => {
  it("é exatamente [30, 60, 90], na ordem do banco", () => {
    expect(JOURNEY_DAY_OFFSETS).toEqual([30, 60, 90]);
  });

  it("as chaves de marco derivadas batem com o formato aceito pela RPC (day_<offset>)", () => {
    // A RPC ack_journey_milestone só valida day_<offset> cujo offset esteja em journey_day_offsets().
    expect(JOURNEY_DAY_OFFSETS.map((n) => `day_${n}`)).toEqual(["day_30", "day_60", "day_90"]);
  });
});
