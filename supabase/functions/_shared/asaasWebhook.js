// WP-ASAAS-02 — parser/auth do webhook Asaas (Deno + Node).
// Sem fetch para api.asaas.com. Sem log de token.
//
// Idempotência oficial = Asaas body.id (external_event_id).
// payload_hash = integridade/auditoria. NÃO substitui external_event_id.
// Environment is attributed from the matching webhook token, never from the body.

import { parseAsaasDateTime } from "./asaas/datetime.js";

const PAYMENT_PREFIX = "PAYMENT_";

export function parseWebhookEnvironment(raw) {
  if (raw === "sandbox" || raw === "production") {
    return { ok: true, environment: raw };
  }
  return { ok: false };
}

export function resolveWebhookSecretName(environment) {
  if (environment === "production") return "ASAAS_WEBHOOK_AUTH_TOKEN_PRODUCTION";
  if (environment === "sandbox") return "ASAAS_WEBHOOK_AUTH_TOKEN_SANDBOX";
  return null;
}

export function normalizeEnvironment(raw) {
  return parseWebhookEnvironment(raw);
}

export function tokensEqual(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") return false;
  const a = received;
  const b = expected;
  const max = Math.max(a.length, b.length, 1);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < max; i += 1) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0 && a.length === b.length && a.length > 0;
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseEventCreatedAt(raw) {
  return parseAsaasDateTime(raw);
}

export function parseEnvelope(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid_json" };
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const event = typeof body.event === "string" ? body.event.trim() : "";
  if (!id || !event) return { ok: false, reason: "invalid_envelope" };
  return {
    ok: true,
    id,
    event,
    dateCreated: parseEventCreatedAt(body.dateCreated),
  };
}

export function extractResource(event, body) {
  if (typeof event === "string" && event.startsWith(PAYMENT_PREFIX)) {
    const payment = body && typeof body === "object" ? body.payment : null;
    if (payment && typeof payment === "object" && typeof payment.id === "string" && payment.id.trim()) {
      return { type: "payment", id: payment.id.trim() };
    }
  }
  if (event === "PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED") {
    const account = body && typeof body === "object" ? body.account : null;
    if (account && typeof account === "object" && typeof account.id === "string" && account.id.trim()) {
      return { type: "pix_automatic_eligibility", id: account.id.trim() };
    }
  }
  if (typeof event === "string" && event.startsWith("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_")) {
    const authorization = body && typeof body === "object" ? body.authorization : null;
    if (
      authorization &&
      typeof authorization === "object" &&
      typeof authorization.id === "string" &&
      authorization.id.trim()
    ) {
      return { type: "pix_automatic_authorization", id: authorization.id.trim() };
    }
  }
  if (typeof event === "string" && event.startsWith("PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_")) {
    const instruction = body && typeof body === "object" ? body.paymentInstruction : null;
    if (
      instruction &&
      typeof instruction === "object" &&
      typeof instruction.id === "string" &&
      instruction.id.trim()
    ) {
      return { type: "pix_automatic_payment_instruction", id: instruction.id.trim() };
    }
  }
  return { type: null, id: null };
}

function trimmed(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * Fatos sanitizados para o processador. Sem payload/encodedImage/pixKey/PII.
 * Campos extras do provider são ignorados — nunca rejeitam o parse.
 */
export function sanitizeProviderFacts(event, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const facts = {};

  if (event === "PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED") {
    const status = trimmed(body.eligibility && body.eligibility.status);
    const accountId = trimmed(body.account && body.account.id);
    if (status === "ELIGIBLE" || status === "INELIGIBLE") facts.eligibilityStatus = status;
    if (accountId) facts.providerAccountId = accountId;
    return Object.keys(facts).length ? facts : null;
  }

  if (typeof event === "string" && event.startsWith("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_")) {
    const authorization = body.authorization;
    if (!authorization || typeof authorization !== "object") return null;
    const id = trimmed(authorization.id);
    const status = trimmed(authorization.status);
    const customerId = trimmed(authorization.customerId);
    const contractId = trimmed(authorization.contractId);
    if (id) facts.providerAuthorizationId = id;
    if (status) facts.providerStatus = status;
    if (customerId) facts.providerCustomerId = customerId;
    if (contractId) facts.providerContractId = contractId;
    if (typeof authorization.value === "number") facts.providerValue = authorization.value;
    const qr = authorization.immediateQrCode;
    if (qr && typeof qr === "object") {
      const conciliation = trimmed(qr.conciliationIdentifier);
      const expires = trimmed(qr.expirationDate);
      if (conciliation) facts.conciliationIdentifier = conciliation;
      if (expires) facts.qrExpiresAt = expires;
    }
    return Object.keys(facts).length ? facts : null;
  }

  if (typeof event === "string" && event.startsWith("PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_")) {
    const instruction = body.paymentInstruction;
    if (!instruction || typeof instruction !== "object") return null;
    const id = trimmed(instruction.id);
    const status = trimmed(instruction.status);
    const dueDate = trimmed(instruction.dueDate);
    const paymentId = trimmed(instruction.paymentId) || trimmed(instruction.payment);
    const authorizationId =
      instruction.authorization && typeof instruction.authorization === "object"
        ? trimmed(instruction.authorization.id)
        : "";
    if (id) facts.providerInstructionId = id;
    if (status) facts.instructionStatus = status;
    if (dueDate) facts.dueDate = dueDate;
    if (paymentId) facts.providerPaymentId = paymentId;
    if (authorizationId) facts.providerAuthorizationId = authorizationId;
    return Object.keys(facts).length ? facts : null;
  }

  return null;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function webhookMisconfiguredResponse() {
  return jsonResponse(503, { error: "webhook_not_configured" });
}

/**
 * Autentica pelo header asaas-access-token, persiste via ingest, responde 2xx.
 * environment vem só do server config — nunca do body.
 * conflict (hash divergente) = HTTP 200 ACK de transporte; original intacto.
 */
export async function handleAsaasWebhook(req, ctx) {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const expected = ctx.expectedToken;
  if (typeof expected !== "string" || expected.length === 0) {
    return webhookMisconfiguredResponse();
  }

  const received = req.headers.get("asaas-access-token");
  if (received == null || received === "") {
    return jsonResponse(401, { error: "unauthorized" });
  }
  if (!tokensEqual(received, expected)) {
    return jsonResponse(403, { error: "forbidden" });
  }

  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return jsonResponse(400, { error: "invalid_body" });
  }

  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  const envelope = parseEnvelope(parsed);
  if (!envelope.ok) {
    return jsonResponse(400, { error: envelope.reason });
  }

  const resource = extractResource(envelope.event, parsed);
  const providerFacts = sanitizeProviderFacts(envelope.event, parsed);
  const payloadHash = await sha256Hex(raw);
  const result = await ctx.ingest({
    provider: "asaas",
    environment: ctx.environment,
    externalEventId: envelope.id,
    eventType: envelope.event,
    eventCreatedAt: envelope.dateCreated,
    externalResourceType: resource.type,
    externalResourceId: resource.id,
    payloadHash,
    providerFacts,
  });

  if (
    result.outcome !== "inserted" &&
    result.outcome !== "duplicate" &&
    result.outcome !== "conflict"
  ) {
    return jsonResponse(500, { error: "ingest_failed" });
  }

  return jsonResponse(200, { received: true });
}

export function resolveWebhookChannelFromToken(cfg) {
  const sandboxToken = typeof cfg.sandboxToken === "string" ? cfg.sandboxToken : "";
  const productionToken = typeof cfg.productionToken === "string" ? cfg.productionToken : "";
  if (!sandboxToken && !productionToken) return { ok: false, reason: "webhook_not_configured" };
  return { ok: true, sandboxToken, productionToken };
}

/**
 * Environment is attributed from the matching auth token, never from the body.
 * Sandbox and Production tokens must be distinct. A missing Production token keeps
 * current Sandbox receipts compatible.
 */
export async function dispatchAsaasWebhook(req, cfg) {
  const channel = resolveWebhookChannelFromToken(cfg);
  if (!channel.ok) return webhookMisconfiguredResponse();

  const received = req.headers.get("asaas-access-token");
  if (received == null || received === "") {
    return jsonResponse(401, { error: "unauthorized" });
  }

  const sandboxMatch = tokensEqual(received, channel.sandboxToken);
  const productionMatch = tokensEqual(received, channel.productionToken);
  if (sandboxMatch && productionMatch) {
    return webhookMisconfiguredResponse();
  }
  if (sandboxMatch) {
    return handleAsaasWebhook(req, {
      environment: "sandbox",
      expectedToken: channel.sandboxToken,
      ingest: cfg.ingest,
    });
  }
  if (productionMatch) {
    return handleAsaasWebhook(req, {
      environment: "production",
      expectedToken: channel.productionToken,
      ingest: cfg.ingest,
    });
  }
  return jsonResponse(403, { error: "forbidden" });
}
