// WP-ASAAS-03 — outbound Vertexa -> Asaas (customer + subscription), Sandbox homologação.
// Caller = Vertexa authenticated (verify_jwt=true). Nunca Asaas, nunca browser anônimo.
//
// Autorização desta WP (temporária, ver plano seção I / gate "AUTHORIZATION TEMPORÁRIA"):
// só platform_admin pode acionar. get_or_create_billing_account já é correta para o
// self-service futuro (auth.uid()-scoped) — só este gate extra é removido depois.
//
// Nunca aceita do body: environment, price, billingType, cycle, external_customer_id,
// external_subscription_id, idempotency_key, external_reference, owner_profile_id,
// subscription_scope. Todos server-derived.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { supabaseUser } from "../_shared/supabaseUser.ts";
import { readAsaasCredentials, resolveOutboundEnvironment } from "../_shared/asaas/client.ts";
import { ensureCustomer, type CustomerFixture } from "../_shared/asaas/customer.ts";
import { ensureSubscription, type SubscriptionFixture } from "../_shared/asaas/subscription.ts";
import {
  listSubscriptionPayments,
  confirmSandboxPayment,
  checkWebhookReceipt,
  type PaymentActionResult,
} from "../_shared/asaas/payment.ts";
import { PRIMARY_SUBSCRIPTION_SCOPE } from "../_shared/asaas/keys.ts";

// ── SANDBOX E2E FIXTURE (ASAAS-03A) — homologação técnica só. NUNCA preço/plano oficial. ──
const CUSTOMER_FIXTURE: CustomerFixture = {
  name: "Vertexa Sandbox QA",
  cpfCnpj: "99991111140", // CPF sintético publicado pela própria Asaas (docs sandbox de teste)
  email: "sandbox-qa@vertexa.test",
  notificationDisabled: true,
};

const SUBSCRIPTION_FIXTURE: SubscriptionFixture = {
  billingType: "PIX",
  cycle: "MONTHLY",
  valueCents: 1000, // R$10,00 — fixture, nunca regra comercial (schema usa CHECK > 0)
  description: "Vertexa Sandbox E2E",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface RequestBody {
  action?: string;
  clinicId?: string;
}

interface BillingAccountResult {
  billing_account_id: string;
  external_customer_id: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
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

  let body: RequestBody;
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as RequestBody) : {};
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  const validActions = [
    "ensure_customer",
    "ensure_subscription",
    "list_subscription_payments",
    "confirm_sandbox_payment",
    "check_webhook_receipt",
  ];
  if (typeof body.action !== "string" || !validActions.includes(body.action)) {
    return jsonResponse(400, { error: "invalid_action" });
  }

  const userClient = supabaseUser(req);

  const { data: isAdmin, error: adminError } = await userClient.rpc("am_i_platform_admin");
  if (adminError) {
    return jsonResponse(401, { error: "unauthorized" });
  }
  if (!isAdmin) {
    return jsonResponse(403, { error: "forbidden" });
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

  // list_subscription_payments / confirm_sandbox_payment / check_webhook_receipt —
  // homologação técnica ASAAS-03B. subscriptionId/customerId/paymentId nunca vêm do body:
  // sempre resolvidos server-side a partir da subscription_scope=primary já persistida
  // (resolve_primary_asaas_subscription).
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
