// Offsets de dias dos MARCOS da jornada (WP-KANBAN B). ESPELHO da constante do banco
// `private.journey_day_offsets()` (migration 20260730090000_wp_kanban_a_journey.sql = {30,60,90}).
// ⚠️ MANTER EM SINCRONIA: a RPC `ack_journey_milestone` só aceita `day_<offset>` cujo offset esteja
// nesta lista (do banco). O teste `journeyOffsets.test.ts` TRAVA o espelho — como no mapa de
// disciplinas (lib/domain/disciplines.ts). A fonte de verdade é o banco; isto é derivação de UI.
//
// Para adicionar 180/365 depois: some a linha em `private.journey_day_offsets()` (banco) E aqui,
// e o teste do espelho voltará a passar.
export const JOURNEY_DAY_OFFSETS = [30, 60, 90] as const;

export type JourneyDayOffset = (typeof JOURNEY_DAY_OFFSETS)[number];
