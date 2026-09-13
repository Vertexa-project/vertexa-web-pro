import { describe, expect, it } from "vitest";

import { classifyAsaasEvent } from "./events.ts";

describe("classifyAsaasEvent", () => {
  it("reconhece Pix Automático sem processar", () => {
    expect(classifyAsaasEvent("PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED")).toMatchObject({
      family: "pix_automatic_eligibility",
      recognized: true,
      processingSupported: false,
    });
    expect(classifyAsaasEvent("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED")).toMatchObject({
      family: "pix_automatic_authorization",
      processingSupported: false,
    });
    expect(classifyAsaasEvent("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED")).toMatchObject({
      family: "pix_automatic_authorization",
      processingSupported: false,
    });
    expect(classifyAsaasEvent("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED")).toMatchObject({
      family: "pix_automatic_authorization",
      processingSupported: false,
    });
    expect(classifyAsaasEvent("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED")).toMatchObject({
      family: "pix_automatic_authorization",
      processingSupported: false,
    });
    expect(classifyAsaasEvent("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED")).toMatchObject({
      family: "pix_automatic_authorization",
      processingSupported: false,
    });
    expect(classifyAsaasEvent("PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CREATED")).toMatchObject({
      family: "pix_automatic_payment_instruction",
      processingSupported: false,
    });
    expect(classifyAsaasEvent("PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED")).toMatchObject({
      family: "pix_automatic_payment_instruction",
      processingSupported: false,
    });
    expect(classifyAsaasEvent("PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_REFUSED")).toMatchObject({
      family: "pix_automatic_payment_instruction",
      processingSupported: false,
    });
    expect(classifyAsaasEvent("PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CANCELLED")).toMatchObject({
      family: "pix_automatic_payment_instruction",
      processingSupported: false,
    });
  });

  it("mantém PAYMENT_* no processador existente e não trata PIX ordinário como automático", () => {
    expect(classifyAsaasEvent("PAYMENT_RECEIVED")).toMatchObject({
      family: "payment",
      processingSupported: true,
    });
    expect(classifyAsaasEvent("PIX")).toMatchObject({
      family: "unrecognized",
      recognized: false,
    });
  });
});
