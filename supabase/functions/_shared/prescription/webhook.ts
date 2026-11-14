// Webhook do provedor de prescrição REAL (Entrega 9) — caminho pronto, SEM provedor ligado.
// Contrato canônico (o adaptador do provedor escolhido traduz o payload dele para este formato, ou esta função ganha um `map` por provedor):
//   POST  header  x-vertexa-signature: <hex HMAC-SHA256 do corpo cru com PRESCRIPTION_WEBHOOK_SECRET_<PROVEDOR>>
//   corpo {"session_id","external_id","title","content","items":[{name,dose,posology,quantity}],"signed_at","sncr_number","pdf_path"}
// Sem segredo configurado a função responde 503 (provedor não conectado): nada é gravado. Idempotente: o servidor devolve `duplicate` para o mesmo external_id.
export interface CanonicalSigned {
  sessionId: string; externalId: string; title: string; content: string;
  items: { name: string; dose: string; posology: string; quantity: string }[];
  signedAt: string | null; sncrNumber: string | null; pdfPath: string | null;
}
export type IngestResult = { ok: true; documentId: string; duplicate: boolean } | { ok: false };
export interface WebhookDeps {
  provider: "memed" | "nexodata";
  secret: string | undefined;
  ingest: (p: CanonicalSigned & { provider: string }) => Promise<IngestResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}
/** Comparação em tempo constante. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function parseCanonical(raw: unknown): CanonicalSigned | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
  const sessionId = str(o.session_id, 64); const externalId = str(o.external_id, 120);
  if (!sessionId || !UUID.test(sessionId) || !externalId || !externalId.trim()) return null;
  const items = Array.isArray(o.items) ? o.items : [];
  if (items.length > 50) return null;
  const outItems: CanonicalSigned["items"] = [];
  for (const it of items) {
    const r = it as Record<string, unknown>;
    const name = str(r?.name, 160);
    if (!name || !name.trim()) return null;
    outItems.push({ name, dose: str(r.dose, 80) ?? "", posology: str(r.posology, 200) ?? "", quantity: str(r.quantity, 40) ?? "" });
  }
  const signedAt = typeof o.signed_at === "string" && !Number.isNaN(Date.parse(o.signed_at)) ? new Date(o.signed_at).toISOString() : null;
  return {
    sessionId, externalId: externalId.trim(), title: str(o.title, 160) ?? "", content: str(o.content, 20000) ?? "", items: outItems,
    signedAt, sncrNumber: str(o.sncr_number, 60), pdfPath: str(o.pdf_path, 300),
  };
}

export async function handlePrescriptionWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!deps.secret) return json(503, { error: "provider_not_configured" });
  const body = await req.text();
  const sig = req.headers.get("x-vertexa-signature") ?? "";
  if (!safeEqual(sig.toLowerCase(), await hmacHex(deps.secret, body))) return json(401, { error: "bad_signature" });
  let parsed: CanonicalSigned | null = null;
  try { parsed = parseCanonical(JSON.parse(body)); } catch { parsed = null; }
  if (!parsed) return json(400, { error: "invalid_payload" });
  const r = await deps.ingest({ ...parsed, provider: deps.provider });
  if (!r.ok) return json(422, { error: "ingest_failed" });
  return json(200, { document_id: r.documentId, duplicate: r.duplicate });
}
