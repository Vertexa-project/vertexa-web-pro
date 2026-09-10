// WP-ASAAS-03B — lookup (read-only) e confirm (Sandbox-only) do payment gerado pela
// subscription primary. subscriptionId/customerId/paymentId NUNCA vêm do client: sempre
// resolvidos a partir do que o próprio ASAAS-03 persistiu (resolve_primary_asaas_subscription).
// Mais de 1 payment candidato = FAIL CLOSED (nunca escolhe automaticamente).
//
// ASAAS-03C — por que list_subscription_payments/checkWebhookReceipt NÃO são sandbox-only
// (diferente de confirmSandboxPayment): o endpoint POST /sandbox/payment/{id}/confirm é uma
// ferramenta de homologação exclusiva do Sandbox Asaas — não existe equivalente em produção,
// por isso confirmSandboxPayment tem o guard explícito. GET /subscriptions/{id}/payments é um
// endpoint normal, válido em qualquer ambiente — restringi-lo a sandbox seria arbitrário e
// quebraria o uso futuro dessas duas actions como ferramenta operacional (suporte/ops
// consultando "esse payment chegou?" em produção). Ambas já falham fechado hoje em produção
// pela ausência de ASAAS_API_KEY_PRODUCTION (gate no topo de index.ts) — essa é a justificativa
// arquitetural para mantê-las ambiente-agnósticas em vez de travadas em sandbox.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { asaasFetch, hasStringId, type AsaasCredentials, type AsaasEnvironment } from "./client.ts";

interface AsaasPayment {
  id: string;
  status: string;
  customer?: string;
  subscription?: string;
}

interface AsaasList<T> {
  data: T[];
}

interface ResolvedSubscription {
  found: boolean;
  external_customer_id?: string | null;
  external_subscription_id?: string | null;
}

export interface PaymentActionResult {
  ok: boolean;
  errorCode?: string;
  httpStatus?: number;
  count?: number;
  paymentId?: string;
  status?: string;
  customerMatch?: boolean;
}

async function resolveSubscription(
  adminClient: SupabaseClient,
  billingAccountId: string,
  environment: AsaasEnvironment,
): Promise<ResolvedSubscription | null> {
  const { data, error } = await adminClient.rpc("resolve_primary_asaas_subscription", {
    p_billing_account_id: billingAccountId,
    p_environment: environment,
  });
  if (error || !data) return null;
  return data as ResolvedSubscription;
}

async function fetchSubscriptionPayments(
  creds: AsaasCredentials,
  environment: AsaasEnvironment,
  externalSubscriptionId: string,
): Promise<{ ok: boolean; payments: AsaasPayment[] }> {
  const res = await asaasFetch<AsaasList<AsaasPayment>>(
    creds,
    environment,
    "GET",
    `/subscriptions/${encodeURIComponent(externalSubscriptionId)}/payments`,
  );
  // Read-only: qualquer outcome que não seja "success" (timeout, 5xx, 2xx vazio/malformado,
  // 4xx) é tratado igual aqui — não há POST a proteger, só reportamos que a leitura falhou.
  if (res.outcome !== "success") {
    return { ok: false, payments: [] };
  }
  return { ok: true, payments: res.data?.data ?? [] };
}

/** Resolve a subscription primary + busca os payments dela. Mesmo caminho para lookup e confirm. */
async function resolveSingleCandidatePayment(params: {
  adminClient: SupabaseClient;
  environment: AsaasEnvironment;
  creds: AsaasCredentials;
  billingAccountId: string;
}): Promise<{ ok: true; payment: AsaasPayment; customerMatch: boolean } | { ok: false; result: PaymentActionResult }> {
  const { adminClient, environment, creds, billingAccountId } = params;

  const resolved = await resolveSubscription(adminClient, billingAccountId, environment);
  if (!resolved || !resolved.found) {
    return { ok: false, result: { ok: false, errorCode: "billing_account_not_found", httpStatus: 404 } };
  }
  if (!resolved.external_subscription_id) {
    return { ok: false, result: { ok: false, errorCode: "subscription_not_ready", httpStatus: 409 } };
  }

  const { ok, payments } = await fetchSubscriptionPayments(creds, environment, resolved.external_subscription_id);
  if (!ok) {
    return { ok: false, result: { ok: false, errorCode: "provider_error", httpStatus: 502 } };
  }
  if (payments.length === 0) {
    return { ok: false, result: { ok: true, count: 0 } };
  }
  if (payments.length > 1) {
    // FAIL CLOSED: nunca escolhe automaticamente entre múltiplos candidatos.
    return { ok: false, result: { ok: false, errorCode: "ambiguous_payments", httpStatus: 409, count: payments.length } };
  }

  const payment = payments[0];
  if (!hasStringId(payment) || typeof payment.status !== "string") {
    return { ok: false, result: { ok: false, errorCode: "invalid_success_shape", httpStatus: 502 } };
  }
  const customerMatch = resolved.external_customer_id ? payment.customer === resolved.external_customer_id : false;
  return { ok: true, payment, customerMatch };
}

export async function listSubscriptionPayments(params: {
  adminClient: SupabaseClient;
  environment: AsaasEnvironment;
  creds: AsaasCredentials;
  billingAccountId: string;
}): Promise<PaymentActionResult> {
  const resolved = await resolveSingleCandidatePayment(params);
  if (!resolved.ok) return resolved.result;
  const { payment, customerMatch } = resolved;
  return { ok: true, count: 1, paymentId: payment.id, status: payment.status, customerMatch };
}

export interface WebhookEventSummary {
  event_type: string;
  external_event_id: string;
  processing_status: string;
  received_at: string;
}

export interface WebhookReceiptResult {
  ok: boolean;
  errorCode?: string;
  httpStatus?: number;
  paymentId?: string;
  events?: WebhookEventSummary[];
}

/** Read-only: nunca confirma nada, só verifica se o webhook real já chegou para o payment resolvido. */
export async function checkWebhookReceipt(params: {
  adminClient: SupabaseClient;
  environment: AsaasEnvironment;
  creds: AsaasCredentials;
  billingAccountId: string;
}): Promise<WebhookReceiptResult> {
  const { adminClient, environment } = params;

  const resolved = await resolveSingleCandidatePayment(params);
  if (!resolved.ok) {
    const { errorCode, httpStatus, count } = resolved.result;
    if (count === 0) {
      return { ok: false, errorCode: "no_payments_yet", httpStatus: 409 };
    }
    return { ok: false, errorCode, httpStatus };
  }
  const { payment } = resolved;

  const { data, error } = await adminClient.rpc("find_billing_provider_events_for_resource", {
    p_provider: "asaas",
    p_environment: environment,
    p_resource_type: "payment",
    p_external_resource_id: payment.id,
  });
  if (error) {
    return { ok: false, errorCode: "webhook_lookup_failed", httpStatus: 502 };
  }

  return { ok: true, paymentId: payment.id, events: (data as WebhookEventSummary[] | null) ?? [] };
}

export async function confirmSandboxPayment(params: {
  adminClient: SupabaseClient;
  environment: AsaasEnvironment;
  creds: AsaasCredentials;
  billingAccountId: string;
}): Promise<PaymentActionResult> {
  const { environment, creds } = params;

  // Defesa em profundidade: mesmo se algum dia production tiver ASAAS_API_KEY_PRODUCTION
  // configurada, este endpoint sandbox/.../confirm nunca deve ser alcançado fora de sandbox.
  if (environment !== "sandbox") {
    return { ok: false, errorCode: "sandbox_only", httpStatus: 403 };
  }

  const resolved = await resolveSingleCandidatePayment(params);
  if (!resolved.ok) {
    // count:0 ("nenhum payment ainda") nunca deve parecer sucesso aqui: confirm_sandbox_payment
    // só devolve ok:true quando de fato confirmou algo. Estado controlado = erro explícito, não
    // um 200 ambíguo que um caller descuidado leria como "confirmado".
    if (resolved.result.count === 0) {
      return { ok: false, errorCode: "no_payments_yet", httpStatus: 409, count: 0 };
    }
    return resolved.result;
  }
  const { payment, customerMatch } = resolved;

  if (!customerMatch) {
    return { ok: false, errorCode: "customer_mismatch", httpStatus: 409 };
  }

  const confirmRes = await asaasFetch<AsaasPayment>(
    creds,
    environment,
    "POST",
    `/sandbox/payment/${encodeURIComponent(payment.id)}/confirm`,
  );
  if (confirmRes.outcome === "deterministic_rejection") {
    return { ok: false, errorCode: "provider_rejected", httpStatus: 502 };
  }
  if (confirmRes.outcome === "unknown" || !confirmRes.data || !hasStringId(confirmRes.data)) {
    // 2xx vazio/malformado/sem id: não sabemos se a confirmação foi aplicada. Nunca reportado
    // como sucesso — o caller deve reconsultar (list_subscription_payments) antes de confiar
    // no status, nunca reconfirmar às cegas assumindo falha.
    return { ok: false, errorCode: "outcome_unknown_requires_reconciliation", httpStatus: 502 };
  }
  if (typeof confirmRes.data.status !== "string") {
    return { ok: false, errorCode: "invalid_success_shape", httpStatus: 502 };
  }

  return { ok: true, count: 1, paymentId: confirmRes.data.id, status: confirmRes.data.status, customerMatch: true };
}
