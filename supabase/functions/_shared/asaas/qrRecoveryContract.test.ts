import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECKOUT_QR_RECOVERY,
  decideQrRecovery,
  inspectAuthorizationFieldPresence,
} from "./qrRecoveryContract.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("QR recovery contract", () => {
  it("reports field presence without copying payload values", () => {
    const presence = inspectAuthorizationFieldPresence({
      id: "auth_1",
      status: "CREATED",
      payload: "000201SECRET",
      encodedImage: "iVBORw0KGgo=",
      immediateQrCode: {
        expirationDate: "2026-09-20 12:00:00",
        conciliationIdentifier: "ASAAS0001",
      },
    });
    expect(presence.hasAuthorizationId).toBe(true);
    expect(presence.hasPayload).toBe(true);
    expect(presence.hasEncodedImage).toBe(true);
    expect(presence.hasConciliationIdentifier).toBe(true);
    expect(presence.hasExpirationDate).toBe(true);
    expect(presence.hasPaymentId).toBe(false);
    expect(presence.hasSubscriptionId).toBe(false);
    expect(JSON.stringify(presence)).not.toContain("000201SECRET");
    expect(JSON.stringify(presence)).not.toContain("iVBORw0KGgo");
  });

  it("treats GET-without-payload as no supported recovery", () => {
    expect(
      decideQrRecovery({
        createHasPayload: true,
        getHasPayload: false,
        getHasEncodedImage: false,
        paymentQrPathSupported: false,
      }),
    ).toBe("NO_SUPPORTED_QR_RECOVERY");
    expect(CHECKOUT_QR_RECOVERY).toBe("NO_SUPPORTED_QR_RECOVERY");
  });

  it("engine still refuses GET as a QR source and never persists payload", () => {
    const pix = readFileSync(resolve(here, "./pixAutomatic.ts"), "utf8");
    const adapter = readFileSync(resolve(here, "./pixAutomaticAuthorization.ts"), "utf8");
    expect(pix).toContain("GET/list NÃO é fonte de QR");
    expect(adapter).toContain("p_conciliation_identifier");
    expect(adapter).not.toMatch(/encodedImage|immediateQrCode\.payload/);
  });
});
