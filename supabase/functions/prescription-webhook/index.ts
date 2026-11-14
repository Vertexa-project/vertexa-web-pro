// FIN-E9 — webhook do provedor de prescrição REAL (ainda NÃO ligado a nenhum provedor: sem PRESCRIPTION_WEBHOOK_SECRET_* responde 503).
// Caller = provedor (POST sem JWT de usuário). Auth = assinatura HMAC no header x-vertexa-signature. Grava só pela RPC doc_ingest_signed (service_role).
// Provedor pela URL: /prescription-webhook?provider=memed|nexodata. Ver docs/financeiro-estoque/entrega-9.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { handlePrescriptionWebhook } from "../_shared/prescription/webhook.ts";

Deno.serve(async (req: Request) => {
  const p = new URL(req.url).searchParams.get("provider");
  if (p !== "memed" && p !== "nexodata") return new Response(JSON.stringify({ error: "unknown_provider" }), { status: 400, headers: { "content-type": "application/json" } });
  return handlePrescriptionWebhook(req, {
    provider: p,
    secret: Deno.env.get(p === "memed" ? "PRESCRIPTION_WEBHOOK_SECRET_MEMED" : "PRESCRIPTION_WEBHOOK_SECRET_NEXODATA"),
    ingest: async (row) => {
      const { data, error } = await supabaseAdmin().rpc("doc_ingest_signed", {
        p_session: row.sessionId, p_provider: row.provider, p_external_id: row.externalId, p_title: row.title, p_content: row.content, p_items: row.items,
        p_signed_at: row.signedAt, p_sncr: row.sncrNumber, p_pdf_path: row.pdfPath, p_patient_extra: {},
      });
      if (error || !data) return { ok: false };
      const r = data as { document_id: string; duplicate: boolean };
      return { ok: true, documentId: r.document_id, duplicate: r.duplicate };
    },
  });
});
