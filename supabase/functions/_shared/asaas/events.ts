// Reconhecimento de famílias de evento Asaas. Processar Pix Automático = ASAAS-05E0B.

export type AsaasEventFamily =
  | "payment"
  | "pix_automatic_eligibility"
  | "pix_automatic_authorization"
  | "pix_automatic_payment_instruction"
  | "hosted_card_checkout"
  | "hosted_card_subscription"
  | "unrecognized";

export interface ClassifiedAsaasEvent {
  eventType: string | null;
  family: AsaasEventFamily;
  recognized: boolean;
  processingSupported: boolean;
}

const AUTHORIZATION_EVENTS = new Set([
  "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED",
  "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED",
  "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED",
  "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED",
  "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED",
]);

const INSTRUCTION_EVENTS = new Set([
  "PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CREATED",
  "PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED",
  "PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_REFUSED",
  "PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CANCELLED",
]);

export function classifyAsaasEvent(eventType: string | null | undefined): ClassifiedAsaasEvent {
  const value = (eventType ?? "").trim();
  if (value === "PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED") {
    return {
      eventType: value,
      family: "pix_automatic_eligibility",
      recognized: true,
      processingSupported: true,
    };
  }
  if (AUTHORIZATION_EVENTS.has(value)) {
    return {
      eventType: value,
      family: "pix_automatic_authorization",
      recognized: true,
      processingSupported: true,
    };
  }
  if (INSTRUCTION_EVENTS.has(value)) {
    return {
      eventType: value,
      family: "pix_automatic_payment_instruction",
      recognized: true,
      processingSupported: true,
    };
  }
  if (["CHECKOUT_CREATED", "CHECKOUT_PAID", "CHECKOUT_CANCELED", "CHECKOUT_EXPIRED"].includes(value)) {
    return { eventType: value, family: "hosted_card_checkout", recognized: true, processingSupported: true };
  }
  if (value === "SUBSCRIPTION_CREATED") {
    return { eventType: value, family: "hosted_card_subscription", recognized: true, processingSupported: true };
  }
  if (value.startsWith("PAYMENT_")) {
    return {
      eventType: value,
      family: "payment",
      recognized: true,
      processingSupported: true,
    };
  }
  return {
    eventType: value || null,
    family: "unrecognized",
    recognized: false,
    processingSupported: false,
  };
}
