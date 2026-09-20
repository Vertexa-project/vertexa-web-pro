// WP-ASAAS-03 — algoritmo de idempotência para create_customer (GATE 5 do plano).
// Nunca repete POST cegamente após timeout/retry/failed anterior: sempre lookup-first.
//
// ASAAS-03C: outcome "unknown" (timeout, 5xx, 2xx sem corpo/id válido) NUNCA autoriza um novo
// POST — só "deterministic_rejection" (4xx/429) prova que a Asaas nunca criou o recurso. Ver
// isOutcomeUnknownCategory em client.ts. Uma duplicação financeira é pior que exigir nova
// reconciliação, então o padrão é sempre bloquear quando em dúvida.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { asaasFetch, hasStringId, isOutcomeUnknownCategory, type AsaasCredentials, type AsaasEnvironment } from "./client.ts";
import { customerExternalReference, customerIdempotencyKey } from "./keys.ts";

export interface CustomerFixture {
  name: string;
  cpfCnpj: string;
  email: string;
  notificationDisabled: boolean;
  mobilePhone?: string;
}

export interface CustomerIdentitySource {
  legalName: string;
  taxId: string;
  email: string;
  mobilePhone?: string | null;
}

/** Server-derived Asaas body. Browser never supplies these fields. */
export function customerBodyFromIdentity(identity: CustomerIdentitySource): CustomerFixture {
  const name = identity.legalName.trim();
  const cpfCnpj = identity.taxId.replace(/\D/g, "");
  const email = identity.email.trim();
  const phone = identity.mobilePhone?.replace(/\D/g, "") ?? "";
  if (!name || !cpfCnpj || !email) {
    throw new Error("identity_incomplete");
  }
  return {
    name,
    cpfCnpj,
    email,
    notificationDisabled: true,
    ...(phone.length >= 10 ? { mobilePhone: phone } : {}),
  };
}

export interface EnsureCustomerResult {
  ok: boolean;
  externalCustomerId?: string;
  errorCode?: string;
}

interface AsaasCustomer {
  id: string;
  externalReference?: string;
}

interface AsaasList<T> {
  data: T[];
}

interface ReserveOutcome {
  outcome: string;
  operation_id: string;
  external_object_id?: string | null;
  last_error_category?: string | null;
}

/**
 * A Asaas é autoridade sobre a identidade do recurso: um customer encontrado/criado só é
 * aceito se o `id` for uma string não vazia e o `externalReference` (quando presente na
 * resposta) bater exatamente com o que pedimos — nunca aceitamos um objeto ambíguo.
 */
function extractCustomerFacts(
  obj: AsaasCustomer,
  expected: { externalReference: string },
): { ok: true; externalCustomerId: string } | { ok: false; reason: string } {
  if (!hasStringId(obj)) {
    return { ok: false, reason: "invalid_success_shape" };
  }
  if (obj.externalReference !== undefined && obj.externalReference !== expected.externalReference) {
    return { ok: false, reason: "reconciliation_external_reference_mismatch" };
  }
  return { ok: true, externalCustomerId: obj.id };
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
  const expected = { externalReference };

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
  let canPost = reserve.outcome === "reserved";

  if (reserve.outcome === "in_flight_retry" || reserve.outcome === "claimed_for_retry") {
    const lookup = await asaasFetch<AsaasList<AsaasCustomer>>(
      creds,
      environment,
      "GET",
      `/customers?externalReference=${encodeURIComponent(externalReference)}`,
    );
    if (lookup.outcome !== "success") {
      // A própria consulta de reconciliação foi inconclusiva: continua bloqueado, zero POST.
      await failOperation(adminClient, operationId, "reconciliation_lookup_failed");
      return { ok: false, errorCode: "reconciliation_lookup_failed" };
    }
    const found = lookup.data?.data ?? [];
    if (found.length === 1) {
      const extracted = extractCustomerFacts(found[0], expected);
      if (!extracted.ok) {
        await failOperation(adminClient, operationId, extracted.reason);
        return { ok: false, errorCode: extracted.reason };
      }
      return await completeCustomer(adminClient, operationId, extracted.externalCustomerId);
    }
    if (found.length > 1) {
      await failOperation(adminClient, operationId, "reconciliation_ambiguous_multiple");
      return { ok: false, errorCode: "reconciliation_ambiguous_multiple" };
    }
    // 0 resultados: só é seguro tentar POST de novo se a tentativa anterior teve uma rejeição
    // determinística comprovada (4xx/429). Qualquer outcome anterior desconhecido — ou nenhuma
    // categoria ainda registrada — bloqueia, sem tocar o ledger (fica pending para a próxima
    // reconciliação decidir com informação nova).
    if (isOutcomeUnknownCategory(reserve.last_error_category)) {
      return { ok: false, errorCode: "outcome_unknown_requires_reconciliation" };
    }
    canPost = true;
  }

  if (!canPost) {
    return { ok: false, errorCode: "outcome_unknown_requires_reconciliation" };
  }

  const createRes = await asaasFetch<AsaasCustomer>(creds, environment, "POST", "/customers", {
    name: fixture.name,
    cpfCnpj: fixture.cpfCnpj,
    email: fixture.email,
    notificationDisabled: fixture.notificationDisabled,
    ...(fixture.mobilePhone ? { mobilePhone: fixture.mobilePhone } : {}),
    externalReference,
  });

  if (createRes.outcome === "deterministic_rejection") {
    await failOperation(adminClient, operationId, createRes.category);
    return { ok: false, errorCode: "provider_rejected" };
  }
  if (createRes.outcome === "unknown" || !createRes.data) {
    // 2xx com corpo vazio/malformado cai aqui também (createRes.data é null nesses casos).
    // Nunca tratado como sucesso nem como rejeição comprovada — outcome desconhecido, a
    // próxima chamada é lookup-only (nunca outro POST às cegas).
    await failOperation(adminClient, operationId, createRes.category);
    return { ok: false, errorCode: "outcome_unknown_requires_reconciliation" };
  }

  const extracted = extractCustomerFacts(createRes.data, expected);
  if (!extracted.ok) {
    // 2xx com JSON válido mas sem `id` utilizável, ou com externalReference divergente do
    // que pedimos: mesmo tratamento — nunca persistir algo que não podemos confiar, e nunca
    // assumir que nada foi criado (por isso outcome_unknown, não provider_rejected).
    await failOperation(adminClient, operationId, extracted.reason);
    return { ok: false, errorCode: "outcome_unknown_requires_reconciliation" };
  }

  return await completeCustomer(adminClient, operationId, extracted.externalCustomerId);
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
