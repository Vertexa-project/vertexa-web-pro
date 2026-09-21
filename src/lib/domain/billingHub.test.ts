import { describe, expect, it } from "vitest";

import {
  CHECKOUT_QR_RECOVERY,
  NEXT_CHARGE_EMPTY_COPY,
  OVERDUE_REGULARIZE_COPY,
  billingHubErrorMessage,
  billingMethodLabel,
  chargeStateLabel,
  chargeStateTone,
  emptyBillingOverview,
  financialSituationCopy,
  formatBillingCivilDate,
  nextChargeCopy,
  paymentStateLabel,
  pixHubLabel,
  resolveHubFourStates,
  sortTimelineNewestFirst,
  timelineEventLabel,
  providerEnvironmentLabel,
  type ClinicBillingOverview,
  type ClinicBillingTimelineEvent,
} from "./billingHub";

const overview = (over: Partial<ClinicBillingOverview> = {}): ClinicBillingOverview => ({
  ...emptyBillingOverview("c1"),
  ...over,
});

describe("billingHub domain", () => {
  it("keeps contract, Pix, payment and entitlement as four separate facts", () => {
    const states = resolveHubFourStates(
      overview({
        plan: {
          displayName: "Pulse",
          priceCents: 39000,
          currency: "BRL",
          billingCycle: "monthly",
          contractStatus: "active",
        },
        pixAuthorizationStatus: "REFUSED",
        latestPaymentDisplayState: "overdue",
      }),
    );
    expect(states.commercialContractStatus).toBe("active");
    expect(states.pixAuthorizationStatus).toBe("REFUSED");
    expect(states.financialPaymentStatus).toBe("overdue");
    expect(states.entitlementEnforcement).toBe("OFF");
    expect(states.entitlementGranted).toBe(false);
  });

  it("does not invent a next charge or show R$ 0 when none exists", () => {
    expect(nextChargeCopy(null)).toBe(NEXT_CHARGE_EMPTY_COPY);
    expect(nextChargeCopy(null)).not.toMatch(/R\$\s*0|0,00/);
    expect(
      nextChargeCopy({
        amountCents: 39000,
        currency: "BRL",
        dueDate: "2026-10-18",
        displayState: "PROGRAMMED",
      }),
    ).toMatch(/390/);
  });

  it("explains overdue without offering a new charge", () => {
    const copy = financialSituationCopy({
      summaryCode: "overdue",
      attention: true,
      overdueCount: 1,
      overdueCents: 39000,
    });
    expect(copy).toMatch(/1 cobrança vencida/);
    expect(copy).toContain(OVERDUE_REGULARIZE_COPY);
    expect(financialSituationCopy({
      summaryCode: "no_charges",
      attention: false,
      overdueCount: 0,
      overdueCents: null,
    })).not.toMatch(/R\$\s*0|0,00/);
  });

  it("translates charge, payment and method states into Portuguese", () => {
    expect(chargeStateLabel("PROGRAMMED")).toBe("Programada");
    expect(chargeStateLabel("PENDING")).toBe("Pendente");
    expect(chargeStateLabel("PAID")).toBe("Paga");
    expect(chargeStateLabel("OVERDUE")).toBe("Vencida");
    expect(chargeStateTone("PROGRAMMED")).toBe("info");
    expect(chargeStateTone("PENDING")).toBe("warning");
    expect(chargeStateTone("PAID")).toBe("success");
    expect(chargeStateTone("OVERDUE")).toBe("destructive");
    expect(paymentStateLabel("received")).toBe("Recebido");
    expect(billingMethodLabel("PIX")).toBe("Pix");
    expect(billingMethodLabel("BOLETO")).toBe("Boleto");
    expect(billingMethodLabel("CREDIT_CARD")).toBe("Cartão");
    expect(billingMethodLabel("UNDEFINED")).toBe("Não informado");
    expect(pixHubLabel(null)).toBe("ainda não configurado");
    expect(pixHubLabel("INTENT")).toMatch(/pronta/i);
    expect(pixHubLabel("CREATED")).toMatch(/aguardando/i);
    expect(pixHubLabel("ACTIVE")).toMatch(/autorizada/i);
    expect(pixHubLabel("REFUSED")).toMatch(/recusada/i);
  });

  it("formats civil dates without inventing values", () => {
    expect(formatBillingCivilDate(null)).toBe("sem data");
    expect(formatBillingCivilDate("2026-10-18")).toMatch(/18/);
  });

  it("orders timeline newest-first with a deterministic tie-break", () => {
    const events: ClinicBillingTimelineEvent[] = [
      { id: "a", occurredAt: "2026-09-01T10:00:00Z", type: "plan_contracted" },
      { id: "c", occurredAt: "2026-09-10T10:00:00Z", type: "pix_refused" },
      { id: "b", occurredAt: "2026-09-10T10:00:00Z", type: "payment_received" },
    ];
    expect(sortTimelineNewestFirst(events).map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(timelineEventLabel("pix_refused")).toBe("Pix Automático recusado");
    expect(timelineEventLabel("charge_programmed")).toBe("Cobrança programada");
    expect(providerEnvironmentLabel("sandbox")).toBe("Sandbox");
    expect(providerEnvironmentLabel("production")).toBe("Produção");
  });

  it("never advertises QR recovery", () => {
    expect(CHECKOUT_QR_RECOVERY).toBe("NO_SUPPORTED_QR_RECOVERY");
  });

  it("maps authority errors without leaking internals", () => {
    expect(billingHubErrorMessage({ hint: "BILLING_NOT_CLINIC_ADMIN" })).toMatch(/administrador/);
    expect(billingHubErrorMessage({ hint: "BILLING_NOT_AUTHENTICATED" })).toMatch(/sessão/);
    expect(billingHubErrorMessage(new Error("boom"))).not.toMatch(/asaas|webhook|service_role/i);
  });
});
