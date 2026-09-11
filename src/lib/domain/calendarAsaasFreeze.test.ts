import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const CALENDAR_SURFACE = [
  "supabase/functions/_shared/calendarPolicy.ts",
  "supabase/functions/_shared/calendarCaller.ts",
  "supabase/functions/_shared/google.ts",
  "supabase/functions/google-calendar-auth/index.ts",
  "supabase/functions/google-calendar-sync/index.ts",
  "supabase/functions/google-calendar-disconnect/index.ts",
  "supabase/functions/google-calendar-callback/index.ts",
  "src/lib/api/calendar.ts",
  "src/lib/domain/calendarPolicy.ts",
  "src/hooks/useCalendarConnection.ts",
];

describe("CAL02A-22 — Asaas freeze", () => {
  it("superfície Calendar não importa Asaas/billing", () => {
    for (const rel of CALENDAR_SURFACE) {
      const src = readFileSync(resolve(root, rel), "utf8");
      expect(src, rel).not.toMatch(/asaas|_shared\/asaas|billing_/i);
    }
  });
});
