import { describe, expect, it } from "vitest";

import {
  addCalendarMonths,
  isBillingPaymentStrategy,
  PIX_AUTOMATIC_POLICY,
  pixAutomaticContractId,
} from "./billingPayment";

describe("payment strategy", () => {
  it("reconhece as três estratégias de produto e recusa billingType PIX", () => {
    expect(isBillingPaymentStrategy("pix_automatic")).toBe(true);
    expect(isBillingPaymentStrategy("pix_manual")).toBe(true);
    expect(isBillingPaymentStrategy("credit_card")).toBe(true);
    expect(isBillingPaymentStrategy("PIX")).toBe(false);
    expect(isBillingPaymentStrategy("boleto")).toBe(false);
  });

  it("congela a política Pix Automático", () => {
    expect(PIX_AUTOMATIC_POLICY.frequency).toBe("MONTHLY");
    expect(PIX_AUTOMATIC_POLICY.paymentCreationMode).toBe("SUBSCRIPTION");
    expect(PIX_AUTOMATIC_POLICY.retryPolicy).toBe("ALLOW_THREE_IN_SEVEN_DAYS");
    expect(PIX_AUTOMATIC_POLICY.finishDate).toBeNull();
  });
});

describe("pixAutomaticContractId", () => {
  it("é estável, 32 chars e sem PII", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(pixAutomaticContractId(id)).toBe("550e8400e29b41d4a716446655440000");
    expect(pixAutomaticContractId(id)).toHaveLength(32);
    expect(pixAutomaticContractId(id)).not.toMatch(/@|cpf|cnpj/i);
  });
});

describe("addCalendarMonths", () => {
  it("usa mês civil, não +30 dias", () => {
    expect(addCalendarMonths("2026-09-15", 1)).toBe("2026-10-15");
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCalendarMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addCalendarMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addCalendarMonths("2026-08-31", 1)).toBe("2026-09-30");
    expect(addCalendarMonths("2026-08-31", 2)).toBe("2026-10-31");
  });
});
