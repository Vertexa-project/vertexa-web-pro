import { describe, expect, it } from "vitest";

import { formatSupportDateTime } from "./supportFormat";

describe("formatSupportDateTime", () => {
  it("mostra no horário de Brasília", () => {
    expect(formatSupportDateTime("2026-11-23T15:05:00Z")).toBe("23/11/2026 12:05");
    expect(formatSupportDateTime("nada")).toBe("");
  });
});
