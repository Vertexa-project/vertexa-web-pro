import { describe, expect, it } from "vitest";

import {
  canReissuePixAutomatic,
  isExpectedPixAutomaticReissueError,
  isPixAutomaticProviderStatus,
  pixAutomaticReissueErrorMessage,
  pixAutomaticStatusLabel,
} from "./pixAutomaticReissue";

describe("pixAutomaticReissue domain", () => {
  it("mostra CTA só para REFUSED", () => {
    expect(canReissuePixAutomatic("REFUSED")).toBe(true);
    for (const status of ["INTENT", "CREATED", "ACTIVE", "CANCELLED", "EXPIRED", null, undefined]) {
      expect(canReissuePixAutomatic(status)).toBe(false);
    }
  });

  it("rotula estados sanitizados sem ids de provider", () => {
    expect(pixAutomaticStatusLabel("REFUSED")).toBe("Recusado");
    expect(pixAutomaticStatusLabel("INTENT")).toBe("Aguardando autorização");
    expect(pixAutomaticStatusLabel("CREATED")).toBe("Criado");
    expect(pixAutomaticStatusLabel("ACTIVE")).toBe("Ativo");
    expect(pixAutomaticStatusLabel("CANCELLED")).toBe("Cancelado");
    expect(pixAutomaticStatusLabel("EXPIRED")).toBe("Expirado");
    expect(pixAutomaticStatusLabel(null)).toBe("Sem autorização");
    expect(isPixAutomaticProviderStatus("REFUSED")).toBe(true);
    expect(isPixAutomaticProviderStatus("cus_000")).toBe(false);
  });

  it("traduz erros conhecidos sem SQL cru", () => {
    expect(pixAutomaticReissueErrorMessage(new Error("forbidden"))).toContain("operador da plataforma");
    expect(pixAutomaticReissueErrorMessage(new Error("authorization_not_refused"))).toContain("Recusado");
    expect(pixAutomaticReissueErrorMessage({ hint: "BILLING_REISSUE_NOT_PRIMARY" })).toContain(
      "autorização mudou",
    );
    expect(pixAutomaticReissueErrorMessage(new Error("mystery_sql"))).toBe(
      "Não foi possível gerar a nova autorização. Tente de novo.",
    );
    expect(isExpectedPixAutomaticReissueError(new Error("forbidden"))).toBe(true);
    expect(isExpectedPixAutomaticReissueError(new Error("mystery_sql"))).toBe(false);
  });
});
