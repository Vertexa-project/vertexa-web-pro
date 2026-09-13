import { describe, expect, it } from "vitest";
import { extractResource, parseEnvelope, sanitizeProviderFacts } from "../asaasWebhook.js";

describe("asaas webhook extract + sanitize", () => {
  it("keeps PAYMENT_* extraction unchanged", () => {
    const body = {
      id: "evt_1",
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_1" },
      extraUnknown: true,
    };
    expect(extractResource("PAYMENT_RECEIVED", body)).toEqual({ type: "payment", id: "pay_1" });
    expect(sanitizeProviderFacts("PAYMENT_RECEIVED", body)).toBeNull();
  });

  it("extracts authorization and drops payload/encodedImage", () => {
    const body = {
      id: "evt_a",
      event: "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED",
      authorization: {
        id: "auth_1",
        status: "CREATED",
        customerId: "cus_1",
        contractId: "550e8400e29b41d4a716446655440000",
        value: 390,
        payload: "00020126SECRET",
        encodedImage: "iVBORw0KGgo",
        unexpected: { foo: 1 },
        immediateQrCode: { conciliationIdentifier: "ASAAS1", expirationDate: "2026-09-13 12:00:00" },
      },
    };
    expect(extractResource(body.event, body)).toEqual({
      type: "pix_automatic_authorization",
      id: "auth_1",
    });
    const facts = sanitizeProviderFacts(body.event, body);
    expect(facts.providerAuthorizationId).toBe("auth_1");
    expect(facts.conciliationIdentifier).toBe("ASAAS1");
    expect(JSON.stringify(facts)).not.toContain("00020126");
    expect(JSON.stringify(facts)).not.toContain("iVBORw0KGgo");
  });

  it("extracts eligibility and instruction official shapes", () => {
    expect(
      extractResource("PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED", {
        account: { id: "acc_1" },
        eligibility: { status: "INELIGIBLE", ineligibleReasons: ["x"] },
      }),
    ).toEqual({ type: "pix_automatic_eligibility", id: "acc_1" });
    expect(
      sanitizeProviderFacts("PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED", {
        account: { id: "acc_1" },
        eligibility: { status: "ELIGIBLE", extra: true },
      }),
    ).toEqual({ eligibilityStatus: "ELIGIBLE", providerAccountId: "acc_1" });

    const instructionBody = {
      paymentInstruction: {
        id: "inst_1",
        status: "SCHEDULED",
        dueDate: "2026-10-04",
        paymentId: "pay_1",
        payment: "pay_alias",
        authorization: { id: "auth_1" },
        extra: 1,
      },
    };
    expect(
      extractResource("PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED", instructionBody),
    ).toEqual({ type: "pix_automatic_payment_instruction", id: "inst_1" });
    expect(
      sanitizeProviderFacts("PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED", instructionBody),
    ).toMatchObject({
      providerInstructionId: "inst_1",
      providerPaymentId: "pay_1",
      providerAuthorizationId: "auth_1",
    });
  });

  it("unknown future event still parses envelope and extracts nothing", () => {
    expect(parseEnvelope({ id: "evt_x", event: "PIX_AUTOMATIC_SOMETHING_NEW", extra: 1 }).ok).toBe(true);
    expect(extractResource("PIX_AUTOMATIC_SOMETHING_NEW", { extra: 1 })).toEqual({
      type: null,
      id: null,
    });
  });
});
