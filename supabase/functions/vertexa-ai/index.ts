// vertexa-ai — Vertexa IA (painel lateral). verify_jwt=true.
// Entrada: { action:"ask", message, screen:{screen,patientId,tab} } | { action:"resolve", request_id, decision:"usado"|"descartado" }.
// Saída (ask): { mode:"demo"|"openai", reply, request_id|null }. Tudo nasce RASCUNHO: esta função NÃO grava dado
// clínico, NÃO envia mensagem, NÃO marca pagamento. Só lê (RLS do usuário) e registra o rastro (quem pediu/decidiu).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsonResponse, preflight } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { aiKey, UUID_RE } from "../_shared/clinical/caller.ts";
import { supabaseUser } from "../_shared/supabaseUser.ts";
import { cleanMessage, hasClinicalAccess } from "../_shared/vertexa/access.ts";
import {
  buildHojeFacts, buildPatientFacts, dayBoundsBR, findPatientByName, sanitizeScreen,
  type RawAppointment, type RawPatient,
} from "../_shared/vertexa/context.ts";
import { buildDemoReply } from "../_shared/vertexa/demo.ts";
import { detectIntent } from "../_shared/vertexa/intent.ts";
import { openaiReply, toAiReply } from "../_shared/vertexa/openai.ts";
import { buildSystemPrompt, buildUserPrompt } from "../_shared/vertexa/prompt.ts";
import { SAFE_FALLBACK, validateReply } from "../_shared/vertexa/validate.ts";
import type { AiReply, Fact } from "../_shared/vertexa/types.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const PATIENT_SELECT = `id, goal, current_weight, target_weight, height_cm,
  profile:profiles ( full_name, status ),
  adherence_snapshots ( status, weekly_completion_rate, calculated_at ),
  activity_events ( type, created_at ),
  weight_logs ( weight_kg, measured_at, review_status ),
  progress_photos ( taken_at )`;

const desc = (a: string | null, b: string | null) => (b ?? "").localeCompare(a ?? "");

function toRawPatient(r: Row): RawPatient | null {
  // Mesma regra do app (isRemovedPatientProfile): inativo ou anonimizado não é paciente ativo.
  if (r.profile?.status === "inactive" || r.profile?.full_name === "Paciente removido") return null;
  const snaps = [...(r.adherence_snapshots ?? [])].sort((a: Row, b: Row) => desc(a.calculated_at, b.calculated_at));
  const ev: Row[] = r.activity_events ?? [];
  const latest = (xs: string[]) => [...xs].sort((a, b) => desc(a, b))[0] ?? null;
  return {
    id: r.id,
    name: r.profile?.full_name ?? null,
    goal: r.goal ?? null,
    heightCm: r.height_cm ?? null,
    currentWeight: r.current_weight ?? null,
    targetWeight: r.target_weight ?? null,
    status: snaps[0]?.status ?? null,
    rate: snaps[0]?.weekly_completion_rate ?? null,
    lastWeightAt: latest((r.weight_logs ?? []).map((w: Row) => w.measured_at)),
    lastPhotoAt: latest((r.progress_photos ?? []).map((p: Row) => p.taken_at)),
    lastWorkoutAt: latest(ev.filter((e) => e.type === "workout_checked").map((e) => e.created_at)),
    lastActivityAt: latest(ev.map((e) => e.created_at)),
    weights: (r.weight_logs ?? []).map((w: Row) => ({ kg: Number(w.weight_kg), at: w.measured_at, review: w.review_status ?? null })),
  };
}

const toAppt = (a: Row): RawAppointment => ({
  id: a.id, title: a.title, startsAt: a.starts_at, patientId: a.patient_id ?? null,
  patientName: a.patient?.profile?.full_name ?? null, type: a.type ?? null,
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  // Desempenho: uma validação de sessão só (antes eram duas) e consultas independentes em paralelo.
  const token = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
  if (!token) return jsonResponse({ error: "unauthenticated" }, 401);
  const user = supabaseUser(req);
  const [{ data: u }, body] = await Promise.all([
    user.auth.getUser(token),
    req.json().catch(() => null) as Promise<Row | null>,
  ]);
  const uid = u.user?.id;
  if (!uid) return jsonResponse({ error: "unauthenticated" }, 401);
  if (!body) return jsonResponse({ error: "invalid_body" }, 400);

  // ---- identidade e clínica do chamador (RLS: só enxerga o que é dele)
  const { data: prof } = await user.from("profiles").select("id").eq("auth_user_id", uid).maybeSingle();
  if (!prof) return jsonResponse({ error: "forbidden" }, 403);
  const { data: pros } = await user.from("professionals").select("id, clinic_id, type").eq("profile_id", prof.id);
  const me = (pros ?? []).find((p: Row) => p.clinic_id) as Row | undefined;
  if (!me) return jsonResponse({ error: "forbidden" }, 403);
  const clinicId = me.clinic_id as string;

  const admin = supabaseAdmin();

  // ---- decisão do profissional sobre um rascunho (rastro de quem aprovou)
  if (body.action === "resolve") {
    const rid = String(body.request_id ?? "");
    const decision = body.decision === "usado" || body.decision === "descartado" ? body.decision : null;
    if (!UUID_RE.test(rid) || !decision) return jsonResponse({ error: "invalid_request" }, 400);
    const { data: orig } = await admin.from("vertexa_ai_events").select("id, clinic_id, profile_id, patient_id, screen, mode, draft_kind")
      .eq("id", rid).eq("kind", "pedido").maybeSingle();
    if (!orig || orig.clinic_id !== clinicId || orig.profile_id !== prof.id) return jsonResponse({ error: "forbidden" }, 403);
    const { error } = await admin.from("vertexa_ai_events").insert({
      clinic_id: clinicId, profile_id: prof.id, kind: decision === "usado" ? "rascunho_usado" : "rascunho_descartado",
      parent_id: orig.id, patient_id: orig.patient_id, screen: orig.screen, mode: orig.mode, draft_kind: orig.draft_kind,
    });
    return jsonResponse({ ok: !error, traced: !error });
  }

  // ---- pedido
  const message = cleanMessage(body.message);
  if (!message) return jsonResponse({ error: "invalid_message" }, 400);
  const screen = sanitizeScreen(body.screen);
  const now = Date.now();

  // Consultas independentes em paralelo; a lista de pacientes só é usada se o papel tiver acesso clínico.
  const { from, to } = dayBoundsBR(new Date(now));
  const [{ data: acc }, { data: apptRows }, { data: patientRows }] = await Promise.all([
    user.rpc("fin_my_access", { p_clinic: clinicId }),
    user.from("appointments")
      .select("id, title, starts_at, patient_id, type, patient:patients ( profile:profiles ( full_name ) )")
      .eq("clinic_id", clinicId).gte("starts_at", from).lt("starts_at", to).order("starts_at", { ascending: true }).limit(40),
    user.from("patients").select(PATIENT_SELECT).order("start_date", { ascending: false }).limit(500),
  ]);
  const staffRoles: string[] = ((acc?.roles ?? []) as Row[]).map((r) => String(r.role));
  const clinical = hasClinicalAccess(Boolean(acc?.is_admin), staffRoles);
  const appts = ((apptRows ?? []) as Row[]).map(toAppt);

  const patients: RawPatient[] = clinical
    ? ((patientRows ?? []) as Row[]).map(toRawPatient).filter((p): p is RawPatient => p !== null)
    : [];

  const intent = detectIntent(message);
  let facts: Fact[] = buildHojeFacts(patients, appts, now, clinical);

  // paciente em foco: o da ficha aberta ou o citado pelo nome (entre os que a RLS já mostrou)
  let focusId = screen.screen === "paciente" ? screen.patientId : null;
  if (!focusId && clinical) focusId = findPatientByName(message, patients.map((p) => ({ id: p.id, name: p.name })));
  let patientFacts: Fact[] | null = null;
  let patientDenied = false;
  if (focusId) {
    let allowed = false;
    let next: Row[] | null = null;
    if (clinical) {
      const [chk, nx] = await Promise.all([
        user.rpc("vertexa_ai_can_access_patient", { p_patient: focusId }),
        user.from("appointments").select("id, title, starts_at, patient_id, type")
          .eq("patient_id", focusId).gte("starts_at", new Date(now).toISOString()).order("starts_at", { ascending: true }).limit(1),
      ]);
      allowed = !chk.error && chk.data === true;
      next = (nx.data ?? null) as Row[] | null;
    }
    const raw = allowed ? patients.find((p) => p.id === focusId) : undefined;
    if (!raw) patientDenied = true;
    else {
      patientFacts = buildPatientFacts(raw, next?.[0] ? toAppt(next[0] as Row) : null, now);
      facts = [...facts, ...patientFacts];
    }
  }

  const key = aiKey();
  const mode = key ? "openai" : "demo";
  let reply: AiReply;
  if (!key) {
    reply = buildDemoReply({ intent, screen, facts, patientFacts, patientDenied, clinical });
  } else if (["pagamento", "diagnostico", "financeiro", "treino"].includes(intent) || (!clinical && intent !== "agenda_hoje" && intent !== "ajuda") || patientDenied) {
    // recusas e bloqueios são do sistema, não do modelo
    reply = buildDemoReply({ intent, screen, facts, patientFacts, patientDenied, clinical });
  } else {
    reply = SAFE_FALLBACK;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const parsed = toAiReply(await openaiReply(key, buildSystemPrompt(), buildUserPrompt(screen, message, facts)));
        if (parsed && validateReply(parsed, facts).ok) {
          if (parsed.draft && patientFacts) {
            parsed.draft.patientId = patientFacts[0]?.patientId ?? null;
            parsed.draft.patientName = String(patientFacts[0]?.value ?? "") || null;
          }
          reply = parsed;
          break;
        }
      } catch (_e) {
        // tenta de novo uma vez; depois resposta segura
      }
    }
  }
  // Rede de segurança: a saída do demo também passa pela validação.
  if (!validateReply(reply, facts).ok) reply = SAFE_FALLBACK;

  const { data: ev, error: evErr } = await admin.from("vertexa_ai_events").insert({
    clinic_id: clinicId, profile_id: prof.id, kind: "pedido", screen: screen.screen, patient_id: patientFacts?.[0]?.patientId ?? null,
    mode, intent, draft_kind: reply.draft?.kind ?? null, blocked: reply.blocked,
  }).select("id").single();
  if (evErr) console.error("vertexa-ai: rastro não gravado", evErr.code);

  return jsonResponse({ mode, reply, request_id: ev?.id ?? null, traced: !evErr });
});
