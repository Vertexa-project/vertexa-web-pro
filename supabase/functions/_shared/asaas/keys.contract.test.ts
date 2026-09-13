import { describe, it, expect } from "vitest";
import {
  customerIdempotencyKey,
  customerExternalReference,
  contractSubscriptionIdempotencyKey,
  contractSubscriptionExternalReference,
  pixAutomaticAuthorizationIdempotencyKey,
  pixAutomaticAuthorizationExternalReference,
} from "./keys.ts";

const ACCOUNT = "11111111-1111-1111-1111-111111111111";
const CONTRACT = "22222222-2222-2222-2222-222222222222";

describe("contract-scoped outbound keys", () => {
  it("customer key remains account-scoped (reuse)", () => {
    expect(customerIdempotencyKey(ACCOUNT)).toBe(`${ACCOUNT}:create_customer`);
    expect(customerExternalReference("sandbox", ACCOUNT)).toBe(
      `vtx:sandbox:${ACCOUNT}:customer`,
    );
  });

  it("subscription key includes commercial_contract_id", () => {
    expect(contractSubscriptionIdempotencyKey(ACCOUNT, CONTRACT)).toBe(
      `${ACCOUNT}:create_subscription:primary:${CONTRACT}`,
    );
    expect(contractSubscriptionExternalReference("sandbox", ACCOUNT, CONTRACT)).toBe(
      `vtx:sandbox:${ACCOUNT}:subscription:primary:${CONTRACT}`,
    );
  });

  it("retry of the same contract produces the same key", () => {
    expect(contractSubscriptionIdempotencyKey(ACCOUNT, CONTRACT)).toBe(
      contractSubscriptionIdempotencyKey(ACCOUNT, CONTRACT),
    );
  });

  it("does not embed PII", () => {
    const ref = contractSubscriptionExternalReference("sandbox", ACCOUNT, CONTRACT);
    expect(ref).not.toMatch(/@/);
    expect(ref).not.toMatch(/cpf|cnpj|patient/i);
  });

  it("pix automatic key is distinct from ordinary subscription and has no PII", () => {
    const key = pixAutomaticAuthorizationIdempotencyKey(ACCOUNT, CONTRACT);
    expect(key).toBe(
      `${ACCOUNT}:create_pix_automatic_authorization:primary:${CONTRACT}`,
    );
    expect(key).not.toContain("create_subscription");
    expect(pixAutomaticAuthorizationExternalReference("sandbox", ACCOUNT, CONTRACT)).toBe(
      `vtx:sandbox:${ACCOUNT}:pix_automatic_authorization:primary:${CONTRACT}`,
    );
    expect(pixAutomaticAuthorizationExternalReference("sandbox", ACCOUNT, CONTRACT)).not.toMatch(
      /@|cpf|cnpj|patient/i,
    );
  });
});
