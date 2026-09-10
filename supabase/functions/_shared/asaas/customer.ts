// WP-ASAAS-03 — algoritmo de idempotência para create_customer (GATE 5 do plano).
// Nunca repete POST cegamente após timeout/retry/failed anterior: sempre lookup-first.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { asaasFetch, classifyAsaasFailure, type AsaasCredentials, type AsaasEnvironment } from "./client.ts";
import { customerExternalReference, customerIdempotencyKey } from "./keys.ts";

export interface CustomerFixture {
  name: string;
  cpfCnpj: string;
  email: string;
  notificationDisabled: boolean;
}

export interface EnsureCustomerResult {
  ok: boolean;
  externalCustomerId?: string;
  errorCode?: string;
}

interface AsaasCustomer {
  id: string;
}

interface AsaasList<T> {
  data: T[];
}

interface ReserveOutcome {
  outcome: string;
  operation_id: string;
  external_object_id?: string | null;
}

export async function ensureCustomer(params: {
  adminClient: SupabaseClient;
  environment: AsaasEnvironment;
  creds: AsaasCredentials;
  billingAccountId: string;
  existingExternalCustomerId: string | null;
  fixture: CustomerFixture;
}): Promise<EnsureCustomerResult> {
  const { adminClient, environment, creds, billingAccountId, existingExternalCustomerId, fixture } = params;

  if (existingExternalCustomerId) {
    return { ok: true, externalCustomerId: existingExternalCustomerId };
  }

  const idempotencyKey = customerIdempotencyKey(billingAccountId);
  const externalReference = customerExternalReference(environment, billingAccountId);

  const { data: reserveData, error: reserveError } = await adminClient.rpc("reserve_billing_outbound_operation", {
    p_billing_account_id: billingAccountId,
    p_provider: "asaas",
    p_environment: environment,
    p_operation_type: "create_customer",
    p_idempotency_key: idempotencyKey,
    p_external_reference: externalReference,
  });
  if (reserveError || !reserveData) {
    return { ok: false, errorCode: "reserve_failed" };
  }
  const reserve = reserveData as ReserveOutcome;

  if (reserve.outcome === "already_completed") {
    return { ok: true, externalCustomerId: reserve.external_object_id ?? undefined };
  }

  const operationId = reserve.operation_id;

  if (reserve.outcome === "in_flight_retry" || reserve.outcome === "claimed_for_retry") {
    const lookup = await asaasFetch<AsaasList<AsaasCustomer>>(
      creds,
      environment,
      "GET",
      `/customers?externalReference=${encodeURIComponent(externalReference)}`,
    );
    if (!lookup.ok) {
      await failOperation(adminClient, operationId, classifyAsaasFailure(lookup));
      return { ok: false, errorCode: "reconciliation_lookup_failed" };
    }
    const found = lookup.data?.data ?? [];
    if (found.length === 1) {
      return await completeCustomer(adminClient, operationId, found[0].id);
    }
    if (found.length > 1) {
      await failOperation(adminClient, operationId, "reconciliation_ambiguous_multiple");
      return { ok: false, errorCode: "reconciliation_ambiguous_multiple" };
    }
    // 0 resultados: a tentativa anterior nunca persistiu no Asaas — segue para o POST.
  }

  const createRes = await asaasFetch<AsaasCustomer>(creds, environment, "POST", "/customers", {
    name: fixture.name,
    cpfCnpj: fixture.cpfCnpj,
    email: fixture.email,
    notificationDisabled: fixture.notificationDisabled,
    externalReference,
  });

  if (!createRes.ok || !createRes.data) {
    await failOperation(adminClient, operationId, classifyAsaasFailure(createRes));
    return { ok: false, errorCode: "provider_error" };
  }

  return await completeCustomer(adminClient, operationId, createRes.data.id);
}

async function completeCustomer(
  adminClient: SupabaseClient,
  operationId: string,
  externalCustomerId: string,
): Promise<EnsureCustomerResult> {
  const { data, error } = await adminClient.rpc("complete_billing_customer_operation", {
    p_operation_id: operationId,
    p_external_customer_id: externalCustomerId,
  });
  if (error || !data) {
    return { ok: false, errorCode: "complete_failed" };
  }
  const result = data as { outcome: string; external_customer_id?: string };
  if (result.outcome === "conflict") {
    return { ok: false, errorCode: "external_id_conflict" };
  }
  return { ok: true, externalCustomerId: result.external_customer_id ?? externalCustomerId };
}

async function failOperation(adminClient: SupabaseClient, operationId: string, category: string): Promise<void> {
  await adminClient.rpc("fail_billing_outbound_operation", {
    p_operation_id: operationId,
    p_error_category: category,
  });
}
