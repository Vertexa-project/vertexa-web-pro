import { describe, expect, it } from "vitest";
import { groupTimeline } from "./timelineGroups";
import { activityEventMeta } from "./activityEvents";
import type { ActivityEvent } from "@/types/db";

let n = 0;
const ev = (type: string, created_at: string, payload: Record<string, unknown> | null = null): ActivityEvent => ({ id: `e${n++}`, patient_id: "p", type, payload, created_at });

describe("rótulos em português", () => {
  it("meal_logged e mood_logged não aparecem em inglês", () => {
    expect(activityEventMeta("meal_logged").label).toBe("Refeição registrada");
    expect(activityEventMeta("mood_logged").label).toBe("Humor registrado");
    expect(activityEventMeta("algum_tipo_novo").label).toBe("Atividade registrada");
  });
});

describe("groupTimeline", () => {
  it("6 copos + 4 refeições + humor no mesmo dia viram UM item", () => {
    const events = [
      ...Array.from({ length: 6 }, (_, i) => ev("hydration_logged", `2026-11-12T1${i}:00:00Z`, { liters: 0.25 })),
      ...Array.from({ length: 4 }, (_, i) => ev("meal_logged", `2026-11-12T0${i + 5}:00:00Z`)),
      ev("mood_logged", "2026-11-12T09:00:00Z"),
      ev("workout_checked", "2026-11-12T20:00:00Z", { workout: "Treino A" }),
    ];
    const items = groupTimeline(events);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "event" });
    const h = items[1];
    expect(h.kind).toBe("habits");
    if (h.kind === "habits") expect(h.summary).toBe("Água 1,5 L em 6 registros · Refeições: 4 registradas · Humor: 1 registro");
  });
  it("dias diferentes (fuso America/Sao_Paulo) ficam em itens separados", () => {
    // 02:00Z de 13/11 ainda é 12/11 em São Paulo (23:00).
    const items = groupTimeline([ev("hydration_logged", "2026-11-13T02:00:00Z", { liters: 0.25 }), ev("hydration_logged", "2026-11-13T15:00:00Z", { liters: 0.25 })]);
    expect(items.map((i) => i.kind === "habits" && i.day)).toEqual(["2026-11-13", "2026-11-12"]);
  });
  it("registro de água sem quantidade diz isso (achado D56)", () => {
    const items = groupTimeline([ev("hydration_logged", "2026-10-15T15:00:00Z", null)]);
    const h = items[0];
    expect(h.kind).toBe("habits");
    if (h.kind === "habits") expect(h.summary).toBe("Água: 1 registro sem quantidade");
  });
});
