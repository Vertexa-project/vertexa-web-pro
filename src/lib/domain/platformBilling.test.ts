import { describe, expect, it } from "vitest";

import {
  attentionReasonLabel,
  emptyOverview,
  financialSummaryLabel,
  nextChargeCopy,
  platformBillingErrorMessage,
} from "./platformBilling";

describe("platformBilling domain", () => {
  it("keeps financial delinquency separate from Pix REFUSED", () => {
    expect(financialSummaryLabel("overdue")).toBe("Vencido");
    expect(attentionReasonLabel("pix_refused")).toBe("Pix Automático recusado");
    expect(attentionReasonLabel("overdue")).toBe("Cobrança vencida");
    expect(attentionReasonLabel("pix_refused")).not.toMatch(/inadimpl|vencid/i);
  });

  it("does not invent a next charge amount", () => {
    expect(nextChargeCopy(null)).toMatch(/Nenhuma cobrança futura/);
    expect(nextChargeCopy(null)).not.toMatch(/R\$\s*0|0,00/);
  });

  it("fails closed for non-platform callers", () => {
    expect(platformBillingErrorMessage({ hint: "BILLING_NOT_PLATFORM_ADMIN" })).toMatch(
      /plataforma/,
    );
    expect(platformBillingErrorMessage({ hint: "BILLING_NOT_AUTHENTICATED" })).toMatch(/sessão/);
  });

  it("never grants entitlement in the empty overview", () => {
    expect(emptyOverview().entitlementEnforcement).toBe("OFF");
  });
});
