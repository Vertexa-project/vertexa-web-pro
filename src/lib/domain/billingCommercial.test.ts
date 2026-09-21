import { describe, expect, it } from "vitest";

import {
  FOUNDER_LIFETIME_DISCOUNT_BPS,
  FOUNDER_MAX_ADMISSIONS,
  additionalCapacityCents,
  billableProfessionalCount,
  canReuseCancelledFounderSlot,
  capacityNotice,
  futureAdjustmentPreview,
  nextFounderSlot,
  resolveFounderBaseCents,
  resolveProjectedCents,
} from "./billingCommercial";

describe("billingCommercial domain", () => {
  it("locks the canonical Founder price during the 12-month window", () => {
    const locked = resolveFounderBaseCents({
      founderEligible: true,
      asOfDate: "2027-09-19",
      lockUntil: "2027-09-20",
      lockedFounderCents: 39000,
      tablePriceCents: 49700,
      lifetimeDiscountBps: FOUNDER_LIFETIME_DISCOUNT_BPS,
      contractedSnapshotCents: 49700,
    });
    expect(locked.reason).toBe("founder_lock");
    expect(locked.baseCents).toBe(39000);
  });

  it("uses 70% of the then-current table after lock expiry", () => {
    const after = resolveFounderBaseCents({
      founderEligible: true,
      asOfDate: "2027-09-20",
      lockUntil: "2027-09-20",
      lockedFounderCents: 39000,
      tablePriceCents: 70000,
      lifetimeDiscountBps: FOUNDER_LIFETIME_DISCOUNT_BPS,
      contractedSnapshotCents: 39000,
    });
    expect(after.reason).toBe("founder_lifetime_table");
    expect(after.baseCents).toBe(49000);
  });

  it("does not rewrite a standard snapshot when Founder is not eligible", () => {
    const standard = resolveFounderBaseCents({
      founderEligible: false,
      asOfDate: "2026-09-20",
      lockUntil: "2027-09-20",
      lockedFounderCents: 39000,
      tablePriceCents: 70000,
      lifetimeDiscountBps: FOUNDER_LIFETIME_DISCOUNT_BPS,
      contractedSnapshotCents: 49700,
    });
    expect(standard.reason).toBe("standard_snapshot");
    expect(standard.baseCents).toBe(49700);
  });

  it("prices Sync and Apex additional units and refuses Pulse overage", () => {
    expect(
      additionalCapacityCents({
        planCode: "sync",
        professionalUnits: 2,
        patientUnits: 1,
        professionalUnitCents: 3900,
        patientUnitCents: 1800,
      }).cents,
    ).toBe(9600);
    expect(
      additionalCapacityCents({
        planCode: "apex",
        professionalUnits: 1,
        patientUnits: 2,
        professionalUnitCents: 3900,
        patientUnitCents: 1200,
      }).cents,
    ).toBe(6300);
    expect(
      additionalCapacityCents({
        planCode: "pulse",
        professionalUnits: 1,
        patientUnits: 0,
        professionalUnitCents: null,
        patientUnitCents: null,
      }).pulseAddonBlocked,
    ).toBe(true);
  });

  it("adds contracted units on top of the Founder lock", () => {
    const projected = resolveProjectedCents({
      founderEligible: true,
      asOfDate: "2026-10-01",
      lockUntil: "2027-09-20",
      lockedFounderCents: 39000,
      tablePriceCents: 49700,
      lifetimeDiscountBps: FOUNDER_LIFETIME_DISCOUNT_BPS,
      contractedSnapshotCents: 39000,
      planCode: "sync",
      professionalUnits: 2,
      patientUnits: 0,
      professionalUnitCents: 3900,
      patientUnitCents: 1800,
    });
    expect(projected.finalProjectedCents).toBe(46800);
    expect(projected.reason).toBe("founder_lock");
  });

  it("never assigns slot 51 and never reuses a historical slot for a new clinic", () => {
    const used = Array.from({ length: 50 }, (_, i) => i + 1);
    expect(nextFounderSlot(used)).toBeNull();
    expect(nextFounderSlot([1, 2, 4])).toBe(3);
    const cancelledNewClinic = canReuseCancelledFounderSlot({
      campaignOpen: true,
      sameClinic: false,
      historicalSlot: 7,
    });
    expect(cancelledNewClinic.reuseSameSlot).toBe(false);
    expect(cancelledNewClinic.consumeNewSlot).toBe(true);
  });

  it("restores Founder on the same slot only while the campaign is open", () => {
    const open = canReuseCancelledFounderSlot({
      campaignOpen: true,
      sameClinic: true,
      historicalSlot: 7,
    });
    expect(open).toEqual({ reuseSameSlot: true, consumeNewSlot: false, restoreBenefit: true });
    const closed = canReuseCancelledFounderSlot({
      campaignOpen: false,
      sameClinic: true,
      historicalSlot: 7,
    });
    expect(closed).toEqual({ reuseSameSlot: true, consumeNewSlot: false, restoreBenefit: false });
  });

  it("exempts exactly one owner and counts extra admins", () => {
    expect(
      billableProfessionalCount({
        ownerProfileId: "owner",
        members: [
          { profileId: "owner", status: "active" },
          { profileId: "admin-2", status: "active" },
          { profileId: "pending", status: "invited" },
          { profileId: "inactive", status: "inactive" },
        ],
      }),
    ).toBe(1);
  });

  it("explains Pulse limit without inventing an overage price", () => {
    const notice = capacityNotice({
      remaining: 0,
      allowed: 2,
      kind: "professional",
      planCode: "pulse",
      canAddUnits: false,
    });
    expect(notice.tone).toBe("limit");
    expect(notice.body).toMatch(/Pulse não tem unidade adicional/);
    expect(notice.body).not.toMatch(/R\$/);
  });

  it("keeps future coupons off the plan table price", () => {
    expect(futureAdjustmentPreview({ kind: "percentage", percentBps: 1000, baseCents: 49700 })).toBe(44730);
    expect(futureAdjustmentPreview({ kind: "fixed_cents", amountCents: 2000, baseCents: 49700 })).toBe(47700);
    expect(FOUNDER_MAX_ADMISSIONS).toBe(50);
  });
});
