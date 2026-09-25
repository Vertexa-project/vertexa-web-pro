// WP-ASAAS-03 / 05E0D / 05G1 / BILLING-PRODUCT-03
// Caller = Vertexa authenticated (verify_jwt=true). Nunca Asaas, nunca browser anônimo.
// Action-level authority. Never a generic authenticated gate.
// Clinic product path: ensure_customer_from_identity + execute own prepared operation.
// PA ops path unchanged. CUSTOMER_FIXTURE stays PA/ops only.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { supabaseUser } from "../_shared/supabaseUser.ts";
import { readAsaasCredentials, resolveOutboundEnvironment } from "../_shared/asaas/client.ts";
import { credentialsForEnvironment } from "../_shared/asaas/pixAutomaticExecution.ts";
import {
  assertProductionProviderWriteForClinic,
  assertSandboxFixtureEnvironment,
} from "../_shared/asaas/productionWriteGuard.ts";
import {
  customerBodyFromIdentity,
  ensureCustomer,
  type CustomerFixture,
} from "../_shared/asaas/customer.ts";
import { ensureSubscription, type SubscriptionFixture } from "../_shared/asaas/subscription.ts";
import { createHostedCardCheckout, type HostedCardCheckoutIntent } from "../_shared/asaas/hostedCardCheckout.ts";
import {
  listSubscriptionPayments,
  confirmSandboxPayment,
  checkWebhookReceipt,
  type PaymentActionResult,
} from "../_shared/asaas/payment.ts";
import { PRIMARY_SUBSCRIPTION_SCOPE } from "../_shared/asaas/keys.ts";
import {
  EXECUTE_PIX_AUTOMATIC_ACTION,
  PROBE_PIX_AUTOMATIC_READ_ACTION,
  executePreparedPixAutomaticAuthorization,
  loadPreparedPixAutomaticAuthorization,
  parseExecutePixAutomaticRequest,
  probePixAutomaticRead,
} from "../_shared/asaas/pixAutomaticExecution.ts";
import {
  REISSUE_PIX_AUTOMATIC_ACTION,
  invokeReissuePixAutomaticAuthorization,
  parseReissuePixAutomaticRequest,
} from "../_shared/asaas/pixAutomaticReissue.ts";
import {
  ACTION_AUTHORITY,
  ENSURE_CUSTOMER_FROM_IDENTITY_ACTION,
  authorityForAction,
  parseEnsureCustomerFromIdentityRequest,
  CREATE_HOSTED_CARD_CHECKOUT_ACTION,
  parseCreateHostedCardCheckoutRequest,
  sanitizeClinicCustomerResponse,
  sanitizeClinicExecuteResponse,
} from "../_shared/asaas/outboundAuthority.ts";

const CUSTOMER_FIXTURE: CustomerFixture = {
  name: "Vertexa Sandbox QA",
  cpfCnpj: "99991111140",
  email: "sandbox-qa@vertexa.test",
  notificationDisabled: true,
};

const SUBSCRIPTION_FIXTURE: SubscriptionFixture = {
  billingType: "PIX",
  cycle: "MONTHLY",
  valueCents: 1000,
  description: "Vertexa Sandbox E2E",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface RequestBody {
  action?: string;
  clinicId?: string;
  commercialContractId?: string;
  authorizationId?: string;
  operationId?: string;
  reason?: string;
}

interface BillingAccountResult {
  billing_account_id: string;
  external_customer_id: string | null;
}

interface ProviderCustomerContext {
  identity_complete?: boolean;
  checkout_ready?: boolean;
  checkout_readiness_error?: string | null;
  legal_name?: string | null;
  tax_id?: string | null;
  email?: string | null;
  mobile_phone?: string | null;
  billing_address?: string | null;
  billing_address_number?: string | null;
  billing_postal_code?: string | null;
  billing_province?: string | null;
  billing_account_id?: string | null;
  environment?: string | null;
  external_customer_id?: string | null;
}

function hostedIntentFromPrepared(raw: unknown): HostedCardCheckoutIntent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const text = (key: string) => typeof value[key] === "string" && value[key].trim() ? value[key].trim() : null;
  const environment = text("environment");
  const status = text("status");
  const currency = text("currency");
  const price = value.price_cents;
  if (
    !text("attempt_id") || !text("billing_account_id") || !text("external_reference") || !text("plan_name") || !text("expires_at") ||
    (environment !== "sandbox" && environment !== "production") || currency !== "BRL" ||
    !Number.isSafeInteger(price) || price <= 0 || typeof value.can_create !== "boolean" ||
    !["CREATING", "ACTIVE", "PAID", "CANCELED", "EXPIRED", "FAILED"].includes(status ?? "")
  ) return null;
  return {
    attemptId: text("attempt_id")!,
    billingAccountId: text("billing_account_id")!,
    environment,
    externalCustomerId: text("external_customer_id"),
    externalReference: text("external_reference")!,
    priceCents: price,
    currency: "BRL",
    planName: text("plan_name")!,
    expiresAt: text("expires_at")!,
    hostedUrl: text("hosted_url"),
    providerCheckoutId: text("provider_checkout_id"),
    canCreate: value.can_create,
    status: status as HostedCardCheckoutIntent["status"],
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  let body: RequestBody;
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as RequestBody) : {};
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  const validActions = Object.keys(ACTION_AUTHORITY);
  if (typeof body.action !== "string" || !validActions.includes(body.action)) {
    return jsonResponse(400, { error: "invalid_action" });
  }

  const gate = authorityForAction(body.action);
  if (!gate) return jsonResponse(400, { error: "invalid_action" });

  const userClient = supabaseUser(req);
  const { data: isAdmin, error: adminError } = await userClient.rpc("am_i_platform_admin");
  if (adminError) {
    return jsonResponse(401, { error: "unauthorized" });
  }
  const isPlatformAdmin = isAdmin === true;

  if (gate === "PA_ONLY" && !isPlatformAdmin) {
    return jsonResponse(403, { error: "forbidden" });
  }

  if (body.action === REISSUE_PIX_AUTOMATIC_ACTION) {
    const parsed = parseReissuePixAutomaticRequest(body);
    if (!parsed.ok) {
      return jsonResponse(400, { error: parsed.error });
    }
    const reissued = await invokeReissuePixAutomaticAuthorization(userClient, parsed);
    return jsonResponse(reissued.status, reissued.body);
  }

  const environment = resolveOutboundEnvironment(Deno.env.get("ASAAS_OUTBOUND_ENVIRONMENT"));
  if (!environment) {
    return jsonResponse(503, { error: "asaas_outbound_not_configured" });
  }

  let credentials;
  try {
    credentials = readAsaasCredentials(environment);
  } catch {
    return jsonResponse(503, { error: "asaas_not_configured" });
  }

  if (body.action === PROBE_PIX_AUTOMATIC_READ_ACTION) {
    const probe = await probePixAutomaticRead({
      configuredEnvironmentRaw: Deno.env.get("ASAAS_OUTBOUND_ENVIRONMENT"),
      creds: credentials,
    });
    return jsonResponse(probe.status, probe.body);
  }

  if (body.action === ENSURE_CUSTOMER_FROM_IDENTITY_ACTION) {
    const parsed = parseEnsureCustomerFromIdentityRequest(body);
    if (!parsed.ok) {
      return jsonResponse(400, { error: parsed.error });
    }
    const { data: clinicAdmin, error: clinicAdminError } = await userClient.rpc("am_i_clinic_admin", {
      p_clinic: parsed.clinicId,
    });
    if (clinicAdminError) return jsonResponse(401, { error: "unauthorized" });
    if (clinicAdmin !== true) return jsonResponse(403, { error: "forbidden" });

    const adminClient = supabaseAdmin();
    const { data: ctxRaw, error: ctxError } = await adminClient.rpc(
      "billing_load_provider_customer_context_outbound",
      { p_clinic_id: parsed.clinicId },
    );
    if (ctxError || !ctxRaw) {
      return jsonResponse(409, { error: "identity_context_unavailable" });
    }
    const ctx = ctxRaw as ProviderCustomerContext;
    if (ctx.identity_complete !== true) {
      return jsonResponse(409, { error: "identity_incomplete" });
    }
    if (!ctx.billing_account_id) {
      return jsonResponse(409, { error: "billing_account_unknown" });
    }
    const accountEnv = ctx.environment === "production" || ctx.environment === "sandbox" ? ctx.environment : null;
    if (!accountEnv) {
      return jsonResponse(409, { error: "invalid_operation_environment" });
    }
    if (accountEnv === "production") {
      const writeGate = await assertProductionProviderWriteForClinic(
        adminClient,
        parsed.clinicId,
        "ENSURE_CUSTOMER_FROM_IDENTITY",
      );
      if (!writeGate.ok) return jsonResponse(409, { error: writeGate.error });
    }

    let identityBody: CustomerFixture;
    try {
      identityBody = customerBodyFromIdentity({
        legalName: ctx.legal_name ?? "",
        taxId: ctx.tax_id ?? "",
        email: ctx.email ?? "",
        mobilePhone: ctx.mobile_phone,
        billingAddress: ctx.billing_address,
        billingAddressNumber: ctx.billing_address_number,
        billingPostalCode: ctx.billing_postal_code,
        billingProvince: ctx.billing_province,
      });
    } catch {
      return jsonResponse(409, { error: "identity_incomplete" });
    }

    let identityCreds;
    try {
      identityCreds = credentialsForEnvironment(accountEnv);
    } catch {
      return jsonResponse(503, { error: "asaas_not_configured" });
    }

    const result = await ensureCustomer({
      adminClient,
      environment: accountEnv,
      creds: identityCreds,
      billingAccountId: ctx.billing_account_id,
      existingExternalCustomerId: ctx.external_customer_id ?? null,
      fixture: identityBody,
    });
    if (!result.ok) {
      return jsonResponse(502, { error: "provider_error", category: result.errorCode });
    }
    return jsonResponse(200, sanitizeClinicCustomerResponse());
  }

  if (body.action === CREATE_HOSTED_CARD_CHECKOUT_ACTION) {
    const parsed = parseCreateHostedCardCheckoutRequest(body);
    if (!parsed.ok) return jsonResponse(400, { error: parsed.error });
    const appBaseUrl = (Deno.env.get("VERTEXA_WEB_APP_URL") ?? "").trim();
    if (!/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(appBaseUrl)) {
      return jsonResponse(503, { error: "checkout_callback_url_not_configured" });
    }
    const { data: clinicAdmin, error: clinicAdminError } = await userClient.rpc("am_i_clinic_admin", {
      p_clinic: parsed.clinicId,
    });
    if (clinicAdminError) return jsonResponse(401, { error: "unauthorized" });
    if (clinicAdmin !== true) return jsonResponse(403, { error: "forbidden" });

    const adminClient = supabaseAdmin();
    const { data: ctxRaw, error: ctxError } = await adminClient.rpc(
      "billing_load_provider_customer_context_outbound",
      { p_clinic_id: parsed.clinicId },
    );
    if (ctxError || !ctxRaw) return jsonResponse(409, { error: "identity_context_unavailable" });
    const ctx = ctxRaw as ProviderCustomerContext;
    if (ctx.identity_complete !== true) return jsonResponse(409, { error: "identity_incomplete" });
    if (ctx.checkout_ready !== true) {
      const readinessError = ctx.checkout_readiness_error;
      const safeError = readinessError === "billing_phone_required" ||
          readinessError === "billing_address_required" ||
          readinessError === "billing_address_number_required" ||
          readinessError === "billing_postal_code_required" ||
          readinessError === "billing_province_required"
        ? readinessError
        : "identity_incomplete";
      return jsonResponse(409, { error: safeError });
    }
    if (!ctx.billing_account_id) return jsonResponse(409, { error: "billing_account_unknown" });
    const accountEnv = ctx.environment === "production" || ctx.environment === "sandbox" ? ctx.environment : null;
    if (!accountEnv) return jsonResponse(409, { error: "invalid_operation_environment" });

    // The local readiness gate runs before this RPC can reserve a new checkout
    // attempt, so missing address data can never produce a provider request or
    // leave an ambiguous creating attempt behind.
    const { data: prepared, error: prepareError } = await userClient.rpc("prepare_my_clinic_hosted_card_checkout", {
      p_clinic_id: parsed.clinicId,
    });
    if (prepareError) return jsonResponse(409, { error: "checkout_prepare_failed" });
    const intent = hostedIntentFromPrepared(prepared);
    if (!intent) return jsonResponse(409, { error: "checkout_prepare_invalid" });
    if (ctx.billing_account_id !== intent.billingAccountId || accountEnv !== intent.environment) {
      return jsonResponse(409, { error: "checkout_customer_context_mismatch" });
    }

    // Never create a new canonical customer behind an already-created legacy
    // checkout. That checkout must be reconciled from authoritative facts.
    if (intent.hostedUrl && intent.providerCheckoutId && !intent.externalCustomerId) {
      return jsonResponse(409, { error: "checkout_customer_unbound_requires_reconciliation" });
    }
    if (!intent.canCreate || (intent.hostedUrl && intent.providerCheckoutId)) {
      let existingCreds;
      try {
        existingCreds = credentialsForEnvironment(intent.environment);
      } catch {
        return jsonResponse(503, { error: "asaas_not_configured" });
      }
      const existing = await createHostedCardCheckout({ adminClient, creds: existingCreds, intent, appBaseUrl });
      if (!existing.ok) return jsonResponse(502, { error: existing.errorCode });
      return jsonResponse(200, { hostedUrl: existing.hostedUrl });
    }

    if (intent.environment === "production") {
      const customerGate = await assertProductionProviderWriteForClinic(adminClient, parsed.clinicId, "ENSURE_CUSTOMER_FROM_IDENTITY");
      if (!customerGate.ok) return jsonResponse(409, { error: customerGate.error });
      const checkoutGate = await assertProductionProviderWriteForClinic(adminClient, parsed.clinicId, "HOSTED_CARD_CHECKOUT_CREATE");
      if (!checkoutGate.ok) return jsonResponse(409, { error: checkoutGate.error });
    }
    let checkoutCreds;
    try {
      checkoutCreds = credentialsForEnvironment(intent.environment);
    } catch {
      return jsonResponse(503, { error: "asaas_not_configured" });
    }

    let identityBody: CustomerFixture;
    try {
      identityBody = customerBodyFromIdentity({
        legalName: ctx.legal_name ?? "",
        taxId: ctx.tax_id ?? "",
        email: ctx.email ?? "",
        mobilePhone: ctx.mobile_phone,
        billingAddress: ctx.billing_address,
        billingAddressNumber: ctx.billing_address_number,
        billingPostalCode: ctx.billing_postal_code,
        billingProvince: ctx.billing_province,
      });
    } catch {
      return jsonResponse(409, { error: "identity_incomplete" });
    }
    const customer = await ensureCustomer({
      adminClient,
      environment: intent.environment,
      creds: checkoutCreds,
      billingAccountId: intent.billingAccountId,
      existingExternalCustomerId: ctx.external_customer_id ?? null,
      fixture: identityBody,
      requireCheckoutReady: true,
    });
    if (!customer.ok || !customer.externalCustomerId) {
      return jsonResponse(502, { error: "provider_error", category: customer.errorCode ?? "customer_not_ready" });
    }
    intent.externalCustomerId = customer.externalCustomerId;

    const created = await createHostedCardCheckout({ adminClient, creds: checkoutCreds, intent, appBaseUrl });
    if (!created.ok) return jsonResponse(502, { error: created.errorCode });
    return jsonResponse(200, { hostedUrl: created.hostedUrl });
  }

  if (body.action === EXECUTE_PIX_AUTOMATIC_ACTION) {
    const parsed = parseExecutePixAutomaticRequest(body);
    if (!parsed.ok) {
      return jsonResponse(400, { error: parsed.error });
    }

    const adminClient = supabaseAdmin();
    if (!isPlatformAdmin) {
      const loaded = await loadPreparedPixAutomaticAuthorization(adminClient, parsed.operationId);
      if (!loaded.ok) {
        return jsonResponse(loaded.error === "operation_not_found" ? 404 : 409, { error: loaded.error });
      }
      const { data: ownsAccount, error: ownsError } = await userClient.rpc(
        "am_i_clinic_admin_for_billing_account",
        { p_billing_account_id: loaded.facts.billingAccountId },
      );
      if (ownsError) return jsonResponse(401, { error: "unauthorized" });
      if (ownsAccount !== true) return jsonResponse(403, { error: "forbidden" });
    }

    const executed = await executePreparedPixAutomaticAuthorization({
      adminClient,
      configuredEnvironmentRaw: Deno.env.get("ASAAS_OUTBOUND_ENVIRONMENT"),
      operationId: parsed.operationId,
    });
    if (!isPlatformAdmin && executed.ok) {
      return jsonResponse(executed.status, sanitizeClinicExecuteResponse(executed.body as Record<string, unknown>));
    }
    return jsonResponse(executed.status, executed.body);
  }

  const clinicId = typeof body.clinicId === "string" && body.clinicId.length > 0 ? body.clinicId : null;

  const { data: accountData, error: accountError } = await userClient.rpc("get_or_create_billing_account", {
    p_provider: "asaas",
    p_environment: environment,
    p_clinic_id: clinicId,
  });
  if (accountError || !accountData) {
    return jsonResponse(400, { error: "billing_account_resolution_failed" });
  }
  const account = accountData as BillingAccountResult;

  const adminClient = supabaseAdmin();

  if (body.action === "ensure_customer") {
    const fixtureGate = assertSandboxFixtureEnvironment(environment);
    if (!fixtureGate.ok) return jsonResponse(409, { error: fixtureGate.error });
    const result = await ensureCustomer({
      adminClient,
      environment,
      creds: credentials,
      billingAccountId: account.billing_account_id,
      existingExternalCustomerId: account.external_customer_id,
      fixture: CUSTOMER_FIXTURE,
    });
    if (!result.ok) {
      return jsonResponse(502, { error: "provider_error", category: result.errorCode });
    }
    return jsonResponse(200, {
      billingAccountId: account.billing_account_id,
      externalCustomerId: result.externalCustomerId,
    });
  }

  if (body.action === "ensure_subscription") {
    const fixtureGate = assertSandboxFixtureEnvironment(environment);
    if (!fixtureGate.ok) return jsonResponse(409, { error: fixtureGate.error });
    if (!account.external_customer_id) {
      return jsonResponse(409, { error: "customer_not_ready" });
    }

    const result = await ensureSubscription({
      adminClient,
      environment,
      creds: credentials,
      billingAccountId: account.billing_account_id,
      externalCustomerId: account.external_customer_id,
      scope: PRIMARY_SUBSCRIPTION_SCOPE,
      fixture: SUBSCRIPTION_FIXTURE,
    });
    if (!result.ok) {
      return jsonResponse(502, { error: "provider_error", category: result.errorCode });
    }
    return jsonResponse(200, {
      billingAccountId: account.billing_account_id,
      externalSubscriptionId: result.externalSubscriptionId,
    });
  }

  const paymentParams = {
    adminClient,
    environment,
    creds: credentials,
    billingAccountId: account.billing_account_id,
  };

  if (body.action === "check_webhook_receipt") {
    const receipt = await checkWebhookReceipt(paymentParams);
    if (!receipt.ok) {
      return jsonResponse(receipt.httpStatus ?? 502, { error: receipt.errorCode ?? "provider_error" });
    }
    return jsonResponse(200, {
      billingAccountId: account.billing_account_id,
      paymentId: receipt.paymentId,
      events: receipt.events ?? [],
    });
  }

  if (body.action === "confirm_sandbox_payment") {
    const fixtureGate = assertSandboxFixtureEnvironment(environment);
    if (!fixtureGate.ok) return jsonResponse(409, { error: fixtureGate.error });
  }

  const paymentResult: PaymentActionResult =
    body.action === "list_subscription_payments"
      ? await listSubscriptionPayments(paymentParams)
      : await confirmSandboxPayment(paymentParams);

  if (!paymentResult.ok) {
    return jsonResponse(paymentResult.httpStatus ?? 502, {
      error: paymentResult.errorCode ?? "provider_error",
      ...(paymentResult.count !== undefined ? { count: paymentResult.count } : {}),
    });
  }

  return jsonResponse(200, {
    billingAccountId: account.billing_account_id,
    count: paymentResult.count,
    ...(paymentResult.paymentId ? { paymentId: paymentResult.paymentId } : {}),
    ...(paymentResult.status ? { status: paymentResult.status } : {}),
    ...(paymentResult.customerMatch !== undefined ? { customerMatch: paymentResult.customerMatch } : {}),
    ...(body.action === "confirm_sandbox_payment" && paymentResult.paymentId ? { confirmed: true } : {}),
  });
});
