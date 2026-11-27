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
  phone?: string;
  address?: string;
  addressNumber?: string;
  postalCode?: string;
  province?: string;
}

export interface CustomerIdentitySource {
  legalName: string;
  taxId: string;
  email: string;
  mobilePhone?: string | null;
  billingAddress?: string | null;
  billingAddressNumber?: string | null;
  billingPostalCode?: string | null;
  billingProvince?: string | null;
}

export interface AuthoritativeCustomerIdentity {
  externalCustomerId: string;
  normalizedTaxId: string;
  name: string | null;
  email: string | null;
  mobilePhone: string | null;
  phone: string | null;
  address: string | null;
  addressNumber: string | null;
  postalCode: string | null;
  province: string | null;
  city: string | null;
  cityName: string | null;
  state: string | null;
}

export type AuthoritativeCustomerResult =
  | { ok: true; customer: AuthoritativeCustomerIdentity }
  | { ok: false; errorCode: string; retryable: boolean };

export function normalizeCustomerTaxId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/[.\-/\s]/g, "");
  return normalized || null;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function phoneDigits(value: unknown): string | null {
  const text = optionalText(value);
  return text ? text.replace(/\D/g, "") || null : null;
}

export function checkoutReadinessError(identity: CustomerIdentitySource): string | null {
  if (!phoneDigits(identity.mobilePhone)) return "billing_phone_required";
  if (!optionalText(identity.billingAddress)) return "billing_address_required";
  if (!optionalText(identity.billingAddressNumber)) return "billing_address_number_required";
  if (!normalizePostalCode(identity.billingPostalCode)) return "billing_postal_code_required";
  if (!optionalText(identity.billingProvince)) return "billing_province_required";
  return null;
}

function normalizePostalCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[\s-]/g, "");
  return /^\d{8}$/.test(normalized) ? normalized : null;
}

export function isCustomerCheckoutReady(customer: Pick<AuthoritativeCustomerIdentity, "phone" | "mobilePhone" | "address" | "addressNumber" | "postalCode" | "province" | "city">): boolean {
  return Boolean(
    phoneDigits(customer.phone ?? customer.mobilePhone) &&
      optionalText(customer.address) &&
      optionalText(customer.addressNumber) &&
      normalizePostalCode(customer.postalCode) &&
      optionalText(customer.province) &&
      optionalText(customer.city),
  );
}

/** Server-derived Asaas body. Browser never supplies these fields. */
export function customerBodyFromIdentity(identity: CustomerIdentitySource): CustomerFixture {
  const name = identity.legalName.trim();
  // The database already validates this source. Preserve alphanumeric CNPJ
  // characters; removing them here would silently corrupt a valid document.
  const cpfCnpj = normalizeCustomerTaxId(identity.taxId) ?? "";
  const email = identity.email.trim();
  const phone = identity.mobilePhone?.replace(/\D/g, "") ?? "";
  const address = identity.billingAddress?.trim() ?? "";
  const addressNumber = identity.billingAddressNumber?.trim() ?? "";
  const postalCode = normalizePostalCode(identity.billingPostalCode) ?? "";
  const province = identity.billingProvince?.trim() ?? "";
  if (!name || !cpfCnpj || !email) {
    throw new Error("identity_incomplete");
  }
  return {
    name,
    cpfCnpj,
    email,
    notificationDisabled: true,
    ...(phone.length >= 10 ? { phone, mobilePhone: phone } : {}),
    ...(address ? { address } : {}),
    ...(addressNumber ? { addressNumber } : {}),
    ...(postalCode ? { postalCode } : {}),
    ...(province ? { province } : {}),
  };
}

export function customerUpdatePayload(
  fixture: CustomerFixture,
  current: AuthoritativeCustomerIdentity,
): Record<string, string> {
  const payload: Record<string, string> = {};
  if (optionalText(fixture.name) !== current.name) payload.name = fixture.name.trim();
  if (optionalText(fixture.email)?.toLowerCase() !== current.email) payload.email = fixture.email.trim().toLowerCase();
  const desiredPhone = phoneDigits(fixture.phone ?? fixture.mobilePhone);
  if (desiredPhone && desiredPhone !== phoneDigits(current.phone)) {
    payload.phone = desiredPhone;
    payload.mobilePhone = desiredPhone;
  }
  const desiredAddress = optionalText(fixture.address);
  if (desiredAddress && desiredAddress !== current.address) payload.address = desiredAddress;
  const desiredAddressNumber = optionalText(fixture.addressNumber);
  if (desiredAddressNumber && desiredAddressNumber !== current.addressNumber) {
    payload.addressNumber = desiredAddressNumber;
  }
  const desiredPostalCode = normalizePostalCode(fixture.postalCode);
  if (desiredPostalCode && desiredPostalCode !== normalizePostalCode(current.postalCode)) {
    payload.postalCode = desiredPostalCode;
  }
  const desiredProvince = optionalText(fixture.province);
  if (desiredProvince && desiredProvince !== current.province) payload.province = desiredProvince;
  return payload;
}

/**
 * Loads a provider customer by its exact ID after transaction correlation.
 * It never searches or links by PII.
 */
export async function getAuthoritativeCustomerIdentity(params: {
  creds: AsaasCredentials;
  environment: AsaasEnvironment;
  externalCustomerId: string;
}): Promise<AuthoritativeCustomerResult> {
  const externalCustomerId = params.externalCustomerId.trim();
  if (!externalCustomerId) {
    return { ok: false, errorCode: "provider_customer_ambiguous", retryable: false };
  }

  const result = await asaasFetch<{
    id?: unknown;
    cpfCnpj?: unknown;
    name?: unknown;
    email?: unknown;
    mobilePhone?: unknown;
    phone?: unknown;
    address?: unknown;
    addressNumber?: unknown;
    postalCode?: unknown;
    province?: unknown;
    city?: unknown;
    cityName?: unknown;
    state?: unknown;
  }>(
    params.creds,
    params.environment,
    "GET",
    `/customers/${encodeURIComponent(externalCustomerId)}`,
  );

  if (result.outcome === "unknown") {
    return { ok: false, errorCode: "provider_customer_lookup_inconclusive", retryable: true };
  }
  if (result.outcome === "deterministic_rejection") {
    if (result.status === 404) {
      return { ok: false, errorCode: "provider_customer_not_found", retryable: false };
    }
    if (result.status === 401 || result.status === 403) {
      return { ok: false, errorCode: "provider_auth_error", retryable: false };
    }
    if (result.category === "rate_limited") {
      return { ok: false, errorCode: "rate_limited", retryable: true };
    }
    return { ok: false, errorCode: "provider_customer_lookup_rejected", retryable: false };
  }

  const customer = result.data;
  const normalizedTaxId = normalizeCustomerTaxId(customer?.cpfCnpj);
  if (!customer || customer.id !== externalCustomerId || !normalizedTaxId) {
    return { ok: false, errorCode: "provider_customer_ambiguous", retryable: false };
  }

  return {
    ok: true,
    customer: {
      externalCustomerId,
      normalizedTaxId,
      name: optionalText(customer.name),
      email: optionalText(customer.email)?.toLowerCase() ?? null,
      mobilePhone: optionalText(customer.mobilePhone ?? customer.phone)?.replace(/\D/g, "") || null,
      phone: phoneDigits(customer.phone),
      address: optionalText(customer.address),
      addressNumber: optionalText(customer.addressNumber),
      postalCode: normalizePostalCode(customer.postalCode),
      province: optionalText(customer.province),
      city: optionalText(customer.city),
      cityName: optionalText(customer.cityName),
      state: optionalText(customer.state),
    },
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
  requireCheckoutReady?: boolean;
}): Promise<EnsureCustomerResult> {
  const {
    adminClient,
    environment,
    creds,
    billingAccountId,
    existingExternalCustomerId,
    fixture,
    requireCheckoutReady = false,
  } = params;

  if (existingExternalCustomerId) {
    const initial = await getAuthoritativeCustomerIdentity({ creds, environment, externalCustomerId: existingExternalCustomerId });
    if (!initial.ok) return { ok: false, errorCode: initial.errorCode };
    if (initial.customer.normalizedTaxId !== normalizeCustomerTaxId(fixture.cpfCnpj)) {
      return { ok: false, errorCode: "provider_customer_identity_conflict" };
    }

    const update = customerUpdatePayload(fixture, initial.customer);
    let authoritative = initial.customer;
    if (Object.keys(update).length > 0) {
      const updateResult = await asaasFetch<AsaasCustomer>(
        creds,
        environment,
        "PUT",
        `/customers/${encodeURIComponent(existingExternalCustomerId)}`,
        update,
      );
      if (updateResult.outcome === "deterministic_rejection") {
        return {
          ok: false,
          errorCode: updateResult.category === "rate_limited" ? "rate_limited" : "provider_customer_update_rejected",
        };
      }

      // A PUT is idempotent, but a transport/5xx outcome is still reconciled
      // through an exact-ID GET instead of assuming that the provider ignored it.
      const readback = await getAuthoritativeCustomerIdentity({ creds, environment, externalCustomerId: existingExternalCustomerId });
      if (!readback.ok) {
        return {
          ok: false,
          errorCode: updateResult.outcome === "unknown"
            ? "provider_customer_update_inconclusive"
            : readback.errorCode,
        };
      }
      authoritative = readback.customer;
      if (authoritative.normalizedTaxId !== normalizeCustomerTaxId(fixture.cpfCnpj)) {
        return { ok: false, errorCode: "provider_customer_identity_conflict" };
      }
    }

    if (requireCheckoutReady && !isCustomerCheckoutReady(authoritative)) {
      return {
        ok: false,
        errorCode: !optionalText(authoritative.city)
          ? "provider_customer_city_missing"
          : "provider_customer_not_checkout_ready",
      };
    }
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
    ...(fixture.phone ? { phone: fixture.phone } : {}),
    ...(fixture.address ? { address: fixture.address } : {}),
    ...(fixture.addressNumber ? { addressNumber: fixture.addressNumber } : {}),
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

  const completed = await completeCustomer(adminClient, operationId, extracted.externalCustomerId);
  if (!completed.ok || !requireCheckoutReady) return completed;

  const readback = await getAuthoritativeCustomerIdentity({
    creds,
    environment,
    externalCustomerId: extracted.externalCustomerId,
  });
  if (!readback.ok) return { ok: false, errorCode: readback.errorCode };
  if (readback.customer.normalizedTaxId !== normalizeCustomerTaxId(fixture.cpfCnpj)) {
    return { ok: false, errorCode: "provider_customer_identity_conflict" };
  }
  if (!isCustomerCheckoutReady(readback.customer)) {
    return {
      ok: false,
      errorCode: !optionalText(readback.customer.city)
        ? "provider_customer_city_missing"
        : "provider_customer_not_checkout_ready",
    };
  }
  return completed;
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
