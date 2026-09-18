import { describe, it, expect } from "vitest";
import {
  customerIdempotencyKey,
  customerExternalReference,
  contractSubscriptionIdempotencyKey,
  contractSubscriptionExternalReference,
  pixAutomaticAuthorizationIdempotencyKey,
  pixAutomaticAuthorizationExternalReference,
  pixAutomaticAuthorizationAttemptIdempotencyKey,
  pixAutomaticAuthorizationAttemptExternalReference,
} from "./keys.ts";

const ACCOUNT = "11111111-1111-1111-1111-111111111111";
const CONTRACT = "22222222-2222-2222-2222-222222222222";
const AUTHORIZATION = "33333333-3333-4333-8333-333333333333";
const AUTHORIZATION_TWO = "44444444-4444-4444-8444-444444444444";

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

  it("attempt key is distinct from the historical primary key and stable per authorization", () => {
    const legacy = pixAutomaticAuthorizationIdempotencyKey(ACCOUNT, CONTRACT);
    const attempt = pixAutomaticAuthorizationAttemptIdempotencyKey(ACCOUNT, AUTHORIZATION);
    const other = pixAutomaticAuthorizationAttemptIdempotencyKey(ACCOUNT, AUTHORIZATION_TWO);
    expect(attempt).toBe(`${ACCOUNT}:create_pix_automatic_authorization:${AUTHORIZATION}`);
    expect(attempt).not.toBe(legacy);
    expect(attempt).not.toContain(":primary:");
    expect(attempt).not.toBe(other);
    expect(pixAutomaticAuthorizationAttemptIdempotencyKey(ACCOUNT, AUTHORIZATION)).toBe(attempt);
    expect(pixAutomaticAuthorizationAttemptExternalReference("sandbox", ACCOUNT, AUTHORIZATION)).toBe(
      `vtx:sandbox:${ACCOUNT}:pix_automatic_authorization:${AUTHORIZATION}`,
    );
    expect(pixAutomaticAuthorizationAttemptExternalReference("sandbox", ACCOUNT, AUTHORIZATION)).not.toBe(
      pixAutomaticAuthorizationExternalReference("sandbox", ACCOUNT, CONTRACT),
    );
  });
});
