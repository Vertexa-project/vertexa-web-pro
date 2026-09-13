// WP-ASAAS-03 — derivação determinística de idempotency_key / externalReference.
// idempotency_key nunca sai da Postgres. externalReference vai pro Asaas: zero PII, só UUID.

import type { AsaasEnvironment } from "./client.ts";

/** Único scope usado nesta WP. subscription_scope existe para reassinatura futura (ASAAS-04+). */
export const PRIMARY_SUBSCRIPTION_SCOPE = "primary";

export function customerIdempotencyKey(billingAccountId: string): string {
  return `${billingAccountId}:create_customer`;
}

export function customerExternalReference(environment: AsaasEnvironment, billingAccountId: string): string {
  return `vtx:${environment}:${billingAccountId}:customer`;
}

export function subscriptionIdempotencyKey(billingAccountId: string, scope: string): string {
  return `${billingAccountId}:create_subscription:${scope}`;
}

export function subscriptionExternalReference(
  environment: AsaasEnvironment,
  billingAccountId: string,
  scope: string,
): string {
  return `vtx:${environment}:${billingAccountId}:subscription:${scope}`;
}

/** Idempotency estável por contrato. Não usar chave aleatória em retry. */
export function contractSubscriptionIdempotencyKey(
  billingAccountId: string,
  commercialContractId: string,
): string {
  return `${billingAccountId}:create_subscription:${PRIMARY_SUBSCRIPTION_SCOPE}:${commercialContractId}`;
}

export function contractSubscriptionExternalReference(
  environment: AsaasEnvironment,
  billingAccountId: string,
  commercialContractId: string,
): string {
  return `vtx:${environment}:${billingAccountId}:subscription:${PRIMARY_SUBSCRIPTION_SCOPE}:${commercialContractId}`;
}

export function pixAutomaticAuthorizationIdempotencyKey(
  billingAccountId: string,
  commercialContractId: string,
): string {
  return `${billingAccountId}:create_pix_automatic_authorization:${PRIMARY_SUBSCRIPTION_SCOPE}:${commercialContractId}`;
}

export function pixAutomaticAuthorizationExternalReference(
  environment: AsaasEnvironment,
  billingAccountId: string,
  commercialContractId: string,
): string {
  return `vtx:${environment}:${billingAccountId}:pix_automatic_authorization:${PRIMARY_SUBSCRIPTION_SCOPE}:${commercialContractId}`;
}
