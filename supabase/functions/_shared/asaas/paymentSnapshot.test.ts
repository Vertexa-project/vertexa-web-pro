// WP-ASAAS-04 — A04-11..A04-24: mapeamento de estado + normalização do payment (paymentSnapshot.ts).
import { describe, it, expect } from "vitest";
import {
  extractPixAutomaticAuthorizationId,
  extractPixAutomaticConciliationIdentifier,
  extractPixTransactionReference,
  mapFinancialState,
  normalizePaymentSnapshot,
  normalizePixAutomaticPaymentSnapshot,
  type AsaasPaymentFull,
} from "./paymentSnapshot.ts";

function basePayment(overrides: Partial<AsaasPaymentFull> = {}): AsaasPaymentFull {
  return {
    id: "pay_1",
    customer: "cus_1",
    subscription: "sub_1",
    status: "RECEIVED",
    value: 10,
    ...overrides,
  };
}

describe("mapFinancialState", () => {
  it("A04-11: PENDING/CONFIRMED/RECEIVED", () => {
    expect(mapFinancialState("PENDING")).toBe("pending");
    expect(mapFinancialState("AWAITING_RISK_ANALYSIS")).toBe("pending");
    expect(mapFinancialState("AUTHORIZED")).toBe("authorized");
    expect(mapFinancialState("CONFIRMED")).toBe("confirmed");
    expect(mapFinancialState("RECEIVED")).toBe("received");
    expect(mapFinancialState("RECEIVED_IN_CASH")).toBe("received");
  });

  it("A04-12: refund/overdue", () => {
    expect(mapFinancialState("REFUND_REQUESTED")).toBe("refund_in_progress");
    expect(mapFinancialState("REFUND_IN_PROGRESS")).toBe("refund_in_progress");
    expect(mapFinancialState("REFUNDED")).toBe("refunded");
    expect(mapFinancialState("OVERDUE")).toBe("overdue");
    expect(mapFinancialState("DUNNING_REQUESTED")).toBe("overdue");
    expect(mapFinancialState("DUNNING_RECEIVED")).toBe("received");
  });

  it("A04-13: chargeback", () => {
    expect(mapFinancialState("CHARGEBACK_REQUESTED")).toBe("chargeback_requested");
    expect(mapFinancialState("CHARGEBACK_DISPUTE")).toBe("chargeback_dispute");
    expect(mapFinancialState("AWAITING_CHARGEBACK_REVERSAL")).toBe("chargeback_reversal_pending");
  });

  it("A04-14: status desconhecido -> unknown (forward-compatible, nunca lança)", () => {
    expect(mapFinancialState("SOME_FUTURE_STATUS")).toBe("unknown");
    expect(mapFinancialState("")).toBe("unknown");
  });
});

describe("normalizePaymentSnapshot", () => {
  it("A04-15: payment RECEIVED válido -> snapshot financial_state=received, valueCents=1000", () => {
    const r = normalizePaymentSnapshot(basePayment({ value: 10 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.financialState).toBe("received");
    expect(r.snapshot.valueCents).toBe(1000);
    expect(r.snapshot.externalPaymentId).toBe("pay_1");
    expect(r.snapshot.externalCustomerId).toBe("cus_1");
    expect(r.snapshot.externalSubscriptionId).toBe("sub_1");
    expect(r.snapshot.providerStatus).toBe("RECEIVED");
  });

  it("A04-16: sem subscription -> missing_subscription (subscription-only, defesa em profundidade)", () => {
    const r = normalizePaymentSnapshot(basePayment({ subscription: undefined }));
    expect(r).toEqual({ ok: false, errorCode: "missing_subscription" });
    const r2 = normalizePaymentSnapshot(basePayment({ subscription: "" }));
    expect(r2).toEqual({ ok: false, errorCode: "missing_subscription" });
  });

  it("A04-17: sem id ou sem customer -> invalid_payment_shape", () => {
    expect(normalizePaymentSnapshot(basePayment({ id: undefined }))).toEqual({ ok: false, errorCode: "invalid_payment_shape" });
    expect(normalizePaymentSnapshot(basePayment({ customer: "" }))).toEqual({ ok: false, errorCode: "invalid_payment_shape" });
    expect(normalizePaymentSnapshot(basePayment({ status: undefined }))).toEqual({ ok: false, errorCode: "invalid_payment_shape" });
  });

  it("A04-18: value não exatamente em centavos -> value_not_exact_cents", () => {
    expect(normalizePaymentSnapshot(basePayment({ value: 10.005 }))).toEqual({ ok: false, errorCode: "value_not_exact_cents" });
    expect(normalizePaymentSnapshot(basePayment({ value: "10" }))).toEqual({ ok: false, errorCode: "value_not_exact_cents" });
  });

  it("A04-19: value <= 0 -> non_positive_value", () => {
    expect(normalizePaymentSnapshot(basePayment({ value: 0 }))).toEqual({ ok: false, errorCode: "non_positive_value" });
  });

  it("A04-20: deleted=true domina -> voided (mesmo com status RECEIVED)", () => {
    const r = normalizePaymentSnapshot(basePayment({ status: "RECEIVED", deleted: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.financialState).toBe("voided");
    expect(r.snapshot.deleted).toBe(true);
  });

  it("A04-21: refund DONE parcial (< total) sobre RECEIVED -> partially_refunded + refundedValueCents", () => {
    const r = normalizePaymentSnapshot(
      basePayment({ value: 10, status: "RECEIVED", refunds: [{ value: 4, status: "DONE" }] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.financialState).toBe("partially_refunded");
    expect(r.snapshot.refundedValueCents).toBe(400);
    expect(r.snapshot.valueCents).toBe(1000);
  });

  it("A04-22: refunds PENDING/CANCELLED não contam -> não vira partially_refunded", () => {
    const r = normalizePaymentSnapshot(
      basePayment({
        value: 10,
        status: "RECEIVED",
        refunds: [
          { value: 4, status: "PENDING" },
          { value: 3, status: "CANCELLED" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.financialState).toBe("received");
    expect(r.snapshot.refundedValueCents).toBe(0);
  });

  it("A04-23: refund total (status REFUNDED) -> refunded", () => {
    const r = normalizePaymentSnapshot(
      basePayment({ value: 10, status: "REFUNDED", refunds: [{ value: 10, status: "DONE" }] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.financialState).toBe("refunded");
  });

  it("A04-24: netValue/datas parseadas, campos extras tolerados", () => {
    const r = normalizePaymentSnapshot(
      basePayment({
        value: 10,
        netValue: 9.5,
        billingType: "PIX",
        dueDate: "2026-09-10",
        paymentDate: "2026-09-11",
        confirmedDate: "2026-09-11",
        // campos desconhecidos do provider — devem ser ignorados sem quebrar
        someFutureField: { nested: true },
        installment: "abc",
      } as AsaasPaymentFull),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.netValueCents).toBe(950);
    expect(r.snapshot.billingType).toBe("PIX");
    expect(r.snapshot.dueDate).toBe("2026-09-10");
    expect(r.snapshot.paymentDate).toBe("2026-09-11");
    expect(r.snapshot.confirmedDate).toBe("2026-09-11");
  });
});

describe("pix automatic payment snapshot", () => {
  it("extracts authorization id from object, string, or authorizationId", () => {
    expect(extractPixAutomaticAuthorizationId({ authorization: { id: "auth_2" } })).toBe("auth_2");
    expect(extractPixAutomaticAuthorizationId({ authorization: "auth_2" })).toBe("auth_2");
    expect(extractPixAutomaticAuthorizationId({ authorizationId: "auth_2" })).toBe("auth_2");
    expect(extractPixAutomaticAuthorizationId({})).toBeNull();
  });

  it("extracts conciliationIdentifier from documented and nested paths only", () => {
    expect(extractPixAutomaticConciliationIdentifier({
      conciliationIdentifier: "ASAAS-TOP",
    })).toEqual({ path: "conciliationIdentifier", value: "ASAAS-TOP" });
    expect(extractPixAutomaticConciliationIdentifier({
      immediateQrCode: { conciliationIdentifier: "ASAAS-QR" },
    })).toEqual({ path: "immediateQrCode.conciliationIdentifier", value: "ASAAS-QR" });
    expect(extractPixAutomaticConciliationIdentifier({
      pix: { extra: { conciliationIdentifier: "ASAAS-NESTED" } },
    } as AsaasPaymentFull)).toEqual({ path: "pix.extra.conciliationIdentifier", value: "ASAAS-NESTED" });
    expect(extractPixAutomaticConciliationIdentifier({ customer: "cus_1", value: 390 })).toBeNull();
  });

  it("05F1-R3: initial payment has no direct conciliationIdentifier and exposes pixTransaction", () => {
    const payment = {
      customer: "cus_payer",
      value: 390,
      pixTransaction: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      pixQrCodeId: "QRCODE-ID-LENGTH-THIRTY-FIVE-00",
    } as AsaasPaymentFull;
    expect(extractPixAutomaticConciliationIdentifier(payment)).toBeNull();
    expect(extractPixTransactionReference(payment)).toEqual({
      present: true,
      path: "pixTransaction",
      type: "string",
      length: 36,
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
    expect(extractPixTransactionReference({ pixTransaction: { id: "tx_obj" } })).toMatchObject({
      present: true,
      path: "pixTransaction.id",
      type: "object",
      id: "tx_obj",
    });
    expect(extractPixTransactionReference({ customer: "cus_1" }).present).toBe(false);
  });

  it("normalizes initial QR payment without subscription", () => {
    const r = normalizePixAutomaticPaymentSnapshot({
      id: "pay_qr",
      customer: "cus_1",
      status: "RECEIVED",
      value: 390,
      billingType: "PIX",
      paymentDate: "2026-09-19",
      confirmedDate: "2026-09-19",
      authorization: { id: "auth_2" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.financialState).toBe("received");
    expect(r.snapshot.valueCents).toBe(39000);
    expect(r.snapshot.providerAuthorizationId).toBe("auth_2");
    expect("externalSubscriptionId" in r.snapshot).toBe(false);
  });

  it("subscription-only normalizer still rejects missing subscription", () => {
    expect(normalizePaymentSnapshot(basePayment({ subscription: undefined }))).toEqual({
      ok: false,
      errorCode: "missing_subscription",
    });
  });
});
