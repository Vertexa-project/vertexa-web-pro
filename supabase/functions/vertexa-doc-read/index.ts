// vertexa-doc-read — Ler PDF/foto (bioimpedância, dieta, treino) para a Conferência. verify_jwt=true.
// Entrada: { action:"read", patient_id, kind, file_path } | { action:"resolve", read_id, decision:"confirmado"|"descartado", fields_corrected?, document_id? }.
// Saída (read): { mode:"demo"|"openai", read_id, result }. Esta função NÃO grava dado clínico: o resultado é RASCUNHO e só a tela de
// Conferência (com o profissional) grava, pelos caminhos que já existem. Aqui fica só o rastro (quem enviou, quem confirmou, quantos
// campos foram corrigidos), sem os valores. Arquivo lido pelo JWT do usuário (RLS do Storage); sem OPENAI_API_KEY = modo demonstração.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { extractText, getDocumentProxy } from "npm:unpdf@1.9.1";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { supabaseUser } from "../_shared/supabaseUser.ts";
import { aiKey, UUID_RE } from "../_shared/clinical/caller.ts";
import { canReadDocFor, hasClinicalAccess, MAX_FILE_BYTES, sniffMime } from "../_shared/docread/access.ts";
import { readDemo } from "../_shared/docread/demo.ts";
import { normalizeModelOutput, unreadable } from "../_shared/docread/model.ts";
import { openaiRead } from "../_shared/docread/openai.ts";
import { isDocKind, type DocKind, type DocReadResult } from "../_shared/docread/types.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const BUCKET = "patient-documents";
const MAX_PAGES = 10;

function todayBR(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

async function pdfPages(bytes: Uint8Array): Promise<string[] | null> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [String(text)]).slice(0, MAX_PAGES);
    return pages.some((p) => p.trim()) ? pages : null;
  } catch (_e) {
    return null;
  }
}

/** verify_jwt=true: o gateway já validou a assinatura; aqui só lemos o `sub` (economiza uma ida ao Auth). */
function jwtSub(token: string): string | null {
  try {
    const part = token.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const p = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
    return p?.role === "authenticated" && typeof p.sub === "string" ? p.sub : null;
  } catch (_e) {
    return null;
  }
}

/** Grava em segundo plano sem segurar a resposta (desempenho). */
function background(p: PromiseLike<unknown>): void {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  const safe = Promise.resolve(p).catch((e) => console.error("vertexa-doc-read: segundo plano falhou", String(e)));
  if (rt?.waitUntil) rt.waitUntil(safe);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
  if (!token) return jsonResponse({ error: "unauthenticated" }, 401);
  const uid = jwtSub(token);
  if (!uid) return jsonResponse({ error: "unauthenticated" }, 401);
  const body = (await req.json().catch(() => null)) as Row | null;
  if (!body) return jsonResponse({ error: "invalid_body" }, 400);
  // Aquecimento: a tela chama ao abrir o seletor de arquivo, para a leitura não pagar a partida da função.
  if (body.action === "ping") return jsonResponse({ ok: true });

  const user = supabaseUser(req);
  const admin = supabaseAdmin();

  // ---- quem chama (RLS: só enxerga o que é dele), já com as disciplinas — uma ida só
  const mePromise = user.from("professionals")
    .select("id, clinic_id, profile_id, profile:profiles!professionals_profile_id_fkey!inner ( auth_user_id ), disciplines:professional_disciplines ( discipline )")
    .eq("profile.auth_user_id", uid)
    .then(({ data }) => (data ?? []).find((p: Row) => p.clinic_id) as Row | undefined);

  // Autorização comum: papel clínico (Recepção/Financeiro/Estoquista não), acesso ao paciente e disciplina que escreve aquele plano.
  // O acesso ao paciente não depende de quem é o profissional: corre junto com a busca do profissional.
  async function authorize(me: Row, patientId: string, kind: DocKind, chkP?: PromiseLike<{ data: unknown; error: unknown }>): Promise<Response | null> {
    const [{ data: acc }, chk] = await Promise.all([
      user.rpc("fin_my_access", { p_clinic: me.clinic_id }),
      chkP ?? user.rpc("vertexa_ai_can_access_patient", { p_patient: patientId }),
    ]);
    const roles: string[] = ((acc?.roles ?? []) as Row[]).map((r) => String(r.role));
    if (!hasClinicalAccess(Boolean(acc?.is_admin), roles)) return jsonResponse({ error: "sem_acesso" }, 403);
    if (chk.error || chk.data !== true) return jsonResponse({ error: "sem_acesso" }, 403);
    const mine = ((me.disciplines ?? []) as Row[]).map((d) => String(d.discipline));
    if (!canReadDocFor(kind, mine)) return jsonResponse({ error: "sem_disciplina" }, 403);
    return null;
  }

  // ---- decisão do profissional (rastro de quem confirmou / descartou)
  if (body.action === "resolve") {
    const rid = String(body.read_id ?? "");
    const decision = body.decision === "confirmado" || body.decision === "descartado" ? (body.decision as string) : null;
    if (!UUID_RE.test(rid) || !decision) return jsonResponse({ error: "invalid_request" }, 400);
    // O rastro da leitura é gravado em segundo plano: numa decisão muito rápida ele pode ainda estar chegando (espera curta).
    const loadOrig = async () => {
      for (let i = 0; i < 4; i++) {
        const { data } = await admin.from("vertexa_doc_reads").select("id, clinic_id, patient_id, kind, status, doc_path, fields_total").eq("id", rid).maybeSingle();
        if (data) return data as Row;
        await new Promise((r) => setTimeout(r, 400));
      }
      return null;
    };
    const [me, orig] = await Promise.all([mePromise, loadOrig()]);
    if (!me) return jsonResponse({ error: "forbidden" }, 403);
    if (!orig || orig.clinic_id !== me.clinic_id) return jsonResponse({ error: "forbidden" }, 403);
    if (orig.status !== "lido") return jsonResponse({ error: "already_resolved" }, 409);
    const denied = await authorize(me, orig.patient_id as string, orig.kind as DocKind);
    if (denied) return denied;
    const profileId = me.profile_id as string;

    const patch: Row = { status: decision, resolved_by: profileId, resolved_at: new Date().toISOString() };
    if (decision === "confirmado") {
      const corrected = Number(body.fields_corrected);
      patch.fields_corrected = Number.isInteger(corrected) && corrected >= 0 ? Math.min(corrected, Number(orig.fields_total ?? 0)) : 0;
      const docId = String(body.document_id ?? "");
      if (UUID_RE.test(docId)) {
        // o documento anexado precisa existir para este paciente (RLS do usuário)
        const { data: d } = await user.from("patient_documents").select("id").eq("id", docId).eq("patient_id", orig.patient_id).maybeSingle();
        if (d) patch.document_id = docId;
      }
    }
    const { data: upd, error } = await admin.from("vertexa_doc_reads").update(patch).eq("id", rid).eq("status", "lido").select("id");
    if (error) return jsonResponse({ error: "trace_failed" }, 500);
    if (!upd?.length) return jsonResponse({ error: "already_resolved" }, 409);
    // Descartar não deixa arquivo solto no bucket (o usuário não tem DELETE; quem apaga é o serviço).
    if (decision === "descartado") background(admin.storage.from(BUCKET).remove([String(orig.doc_path)]));
    return jsonResponse({ ok: true, traced: true });
  }

  // ---- leitura
  if (body.action !== "read") return jsonResponse({ error: "invalid_request" }, 400);
  const patientId = String(body.patient_id ?? "");
  const kind = body.kind;
  const path = String(body.file_path ?? "");
  if (!UUID_RE.test(patientId) || !isDocKind(kind)) return jsonResponse({ error: "invalid_request" }, 400);
  if (!new RegExp(`^${patientId}/[A-Za-z0-9._-]{1,80}$`).test(path)) return jsonResponse({ error: "invalid_path" }, 400);

  // Tudo o que só depende do pedido corre junto; o arquivo baixado só é usado depois de autorizar.
  // (os construtores do supabase-js só disparam no `then`: `.then((r) => r)` faz a consulta começar já)
  const chkP = user.rpc("vertexa_ai_can_access_patient", { p_patient: patientId }).then((r) => r);
  const dlP = user.storage.from(BUCKET).download(path);
  const patP = user.from("patients").select("profile:profiles ( full_name )").eq("id", patientId).maybeSingle().then((r) => r);
  const me = await mePromise;
  if (!me) return jsonResponse({ error: "forbidden" }, 403);
  const [denied, { data: blob, error: dlErr }, { data: pat }] = await Promise.all([authorize(me, patientId, kind, chkP), dlP, patP]);
  if (denied) return denied;
  const clinicId = me.clinic_id as string;
  const profileId = me.profile_id as string;
  if (dlErr || !blob) return jsonResponse({ error: "file_not_found" }, 404);
  if (blob.size > MAX_FILE_BYTES) return jsonResponse({ error: "file_too_large" }, 413);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime) return jsonResponse({ error: "unsupported_type" }, 415);
  const isImage = mime !== "application/pdf";
  const patientName = (pat as Row | null)?.profile?.full_name ?? null;
  const today = todayBR();

  const pages = isImage ? null : await pdfPages(bytes);
  if (!isImage && pages === null && bytes.length > 0 && !new TextDecoder("latin1").decode(bytes.subarray(0, 2048)).includes("%PDF-")) {
    return jsonResponse({ error: "unreadable_file" }, 422);
  }

  const key = aiKey();
  let result: DocReadResult;
  if (!key) {
    result = readDemo({ kind, pages, isImage, patientName, today });
  } else {
    result = unreadable(kind);
    let providerDown = false;
    for (let attempt = 0; attempt < 2 && !providerDown; attempt++) {
      try {
        const raw = await openaiRead(key, kind, { mime, base64: toBase64(bytes), name: "documento" }, pages ? pages.join("\n\f\n") : null);
        const parsed = normalizeModelOutput(kind, raw, { pages, today, patientName });
        if (parsed) { result = parsed; break; }
      } catch (_e) {
        providerDown = true; // falha de transporte/provedor não é erro de interpretação: não repete
      }
    }
    if (providerDown) {
      result = readDemo({ kind, pages, isImage, patientName, today });
      result.notice = result.notice ?? "A Vertexa IA não respondeu agora; li o texto do PDF pelas regras básicas. Confira tudo com atenção.";
    }
  }

  const readId = crypto.randomUUID();
  // Limpeza em segundo plano: leitura dessa pessoa aberta há mais de 1 h e nunca decidida (navegador fechado no meio da
  // Conferência) vira "descartado" sem autor (automático) e o arquivo solto sai do bucket — se não foi anexado em Documentos.
  background((async () => {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: stale } = await admin.from("vertexa_doc_reads").select("id, doc_path")
      .eq("uploaded_by", profileId).eq("status", "lido").lt("created_at", cutoff).limit(20);
    if (!stale?.length) return;
    const paths = (stale as Row[]).map((r) => String(r.doc_path));
    const { data: used } = await admin.from("patient_documents").select("file_path").in("file_path", paths);
    const keep = new Set(((used ?? []) as Row[]).map((d) => String(d.file_path)));
    await admin.from("vertexa_doc_reads").update({ status: "descartado", resolved_at: new Date().toISOString() })
      .in("id", (stale as Row[]).map((r) => r.id)).eq("status", "lido");
    const loose = paths.filter((x) => !keep.has(x));
    if (loose.length) await admin.storage.from(BUCKET).remove(loose);
  })());

  // Rastro em segundo plano: a Conferência leva segundos até a decisão, e o "resolve" só existe depois dela.
  background(admin.from("vertexa_doc_reads").insert({
    id: readId, clinic_id: clinicId, patient_id: patientId, kind, mode: result.mode, status: "lido", uploaded_by: profileId, doc_path: path,
    fields_total: result.fields.length, fields_uncertain: result.fields.filter((f) => f.uncertain).length,
  }).then(({ error }) => { if (error) throw new Error(error.code ?? "insert"); }));
  return jsonResponse({ mode: result.mode, read_id: readId, result });
});
