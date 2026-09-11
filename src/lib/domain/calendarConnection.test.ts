import { describe, expect, it } from "vitest";

import { connectionErrorMessage } from "./calendarConnection";

describe("connectionErrorMessage — CALENDAR-02A", () => {
  it("google_not_configured e redirect_not_configured usam a mesma mensagem de ambiente", () => {
    expect(connectionErrorMessage("google_not_configured")).toBe(
      "Integração ainda não configurada neste ambiente.",
    );
    expect(connectionErrorMessage("redirect_not_configured")).toBe(
      "Integração ainda não configurada neste ambiente.",
    );
  });

  it("tenant_mismatch não sugere autoridade de admin sobre outra agenda", () => {
    expect(connectionErrorMessage("tenant_mismatch")).toMatch(/própria agenda/i);
  });

  it("not_professional cobre Platform Admin sem membership", () => {
    expect(connectionErrorMessage("not_professional")).toMatch(/profissional ativo/i);
  });
});
