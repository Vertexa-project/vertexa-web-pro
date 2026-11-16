// Monta os FATOS a partir de linhas já lidas do banco (com o JWT do usuário → RLS). Puro: sem I/O.
// Regra do guia: número vem do sistema. Tudo o que a IA pode citar nasce aqui.
import { ACTION_LABEL, classify } from "./attention.ts";
import type { Fact, ScreenContext, ScreenKey } from "./types.ts";

export const BR_TZ = "America/Sao_Paulo";

export interface RawPatient {
  id: string;
  name: string | null;
  goal: string | null;
  heightCm: number | null;
  currentWeight: number | null;
  targetWeight: number | null;
  status: string | null;
  rate: number | null;
  /** risk_factors do último cálculo de adesão (os "Sinais recentes" da ficha). */
  riskFactors?: string[];
  lastWeightAt: string | null;
  lastPhotoAt: string | null;
  lastWorkoutAt: string | null;
  lastActivityAt: string | null;
  /** Medidas de weight_logs (a função ignora pendente/rejeitada e fora de 20–400 kg). */
  weights: Array<{ kg: number; at: string; review: string | null }>;
}
export interface RawAppointment { id: string; title: string; startsAt: string; patientId: string | null; patientName: string | null; type: string | null }

export const fmtNum = (n: number, digits = 1) =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(n);
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { timeZone: BR_TZ, hour: "2-digit", minute: "2-digit" });
export const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: BR_TZ, day: "2-digit", month: "2-digit" });
/** AAAA-MM-DD em Brasília. */
export const isoDayBR = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: BR_TZ });

/** Limites [início, fim) do dia de Brasília (UTC-3 fixo desde 2019, sem horário de verão). */
export function dayBoundsBR(now: Date): { from: string; to: string } {
  const day = isoDayBR(now);
  const from = new Date(`${day}T00:00:00-03:00`);
  return { from: from.toISOString(), to: new Date(from.getTime() + 86_400_000).toISOString() };
}

export function latestValidWeight(p: RawPatient): { kg: number; at: string | null } | null {
  const ok = p.weights
    .filter((w) => w.kg >= 20 && w.kg <= 400 && (w.review == null || w.review === "ok" || w.review === "approved"))
    .sort((a, b) => b.at.localeCompare(a.at));
  if (ok[0]) return { kg: ok[0].kg, at: ok[0].at };
  if (p.currentWeight != null && p.currentWeight >= 20 && p.currentWeight <= 400) return { kg: p.currentWeight, at: null };
  return null;
}

const toAtt = (p: RawPatient) => ({
  status: p.status, rate: p.rate, lastWeightAt: p.lastWeightAt, lastPhotoAt: p.lastPhotoAt,
  lastWorkoutAt: p.lastWorkoutAt, lastActivityAt: p.lastActivityAt,
});

const RANK = { em_risco: 0, atencao: 1, ok: 2 } as const;

export function appointmentFacts(appts: RawAppointment[]): Fact[] {
  const out: Fact[] = [{ key: "agenda_total", label: "Compromissos hoje", value: appts.length, source: "Agenda" }];
  for (const a of appts) {
    out.push({
      key: `agenda:${a.id}`,
      label: `${fmtTime(a.startsAt)} · ${a.title}`,
      value: a.patientName ?? "Sem paciente",
      source: "Agenda",
      patientId: a.patientId,
    });
  }
  return out;
}

/** Fatos do dia. `clinical=false` (Recepção/Financeiro/Estoque): só agenda, nenhum dado clínico. */
export function buildHojeFacts(patients: RawPatient[], appts: RawAppointment[], now: number, clinical: boolean): Fact[] {
  const facts = appointmentFacts(appts);
  if (!clinical) return facts;
  const rows = patients.map((p) => ({ p, a: classify(toAtt(p), now) }));
  const emRisco = rows.filter((r) => r.a.level === "em_risco").length;
  const atencao = rows.filter((r) => r.a.level === "atencao").length;
  const pend = rows.filter((r) => r.a.hasPendency).length;
  const rates = patients.map((p) => p.rate ?? 0);
  facts.push(
    { key: "total", label: "Pacientes ativos", value: patients.length, source: "Pacientes" },
    { key: "em_risco", label: "Em risco", value: emRisco, source: "Foco do dia" },
    { key: "atencao", label: "Em atenção", value: atencao, source: "Foco do dia" },
    { key: "pendencias", label: "Com pendências de registro", value: pend, source: "Pendências" },
  );
  if (rates.length) facts.push({ key: "adesao_media", label: "Adesão média", value: Math.round(rates.reduce((a, b) => a + b, 0) / rates.length), source: "Adesão" });
  const foco = rows
    .filter((r) => r.a.level !== "ok")
    .sort((x, y) => RANK[x.a.level] - RANK[y.a.level] || y.a.reasons.length - x.a.reasons.length);
  facts.push({ key: "foco_total", label: "Pacientes no Foco do dia", value: foco.length, source: "Foco do dia" });
  for (const r of foco.slice(0, 5)) {
    facts.push({
      key: `foco:${r.p.id}`,
      label: r.p.name ?? "Sem nome",
      value: r.a.reasons.map((x) => x.label).join("; "),
      source: "Foco do dia",
      patientId: r.p.id,
      reason: r.a.reasons[0]?.kind ?? null,
    });
  }
  const semreg = rows.filter((r) => r.a.since == null || r.a.since >= 8);
  // Número que a resposta cita ("N pacientes estão…") precisa existir nos fatos (achado D66: virava resposta de segurança).
  facts.push({ key: "semreg_total", label: "Pacientes sem registrar há mais de uma semana", value: semreg.length, source: "Adesão" });
  for (const r of semreg) {
    {
      facts.push({
        key: `semreg:${r.p.id}`,
        label: r.p.name ?? "Sem nome",
        value: r.a.since == null ? "Ainda não registrou no app" : `Sem registro há ${r.a.since} dias`,
        source: "Adesão",
        patientId: r.p.id,
        reason: r.a.since == null ? "never_registered" : "no_record",
      });
    }
  }
  return facts;
}

/** Fatos de UM paciente (só chamar depois de can_access_patient). */
export function buildPatientFacts(p: RawPatient, nextAppt: RawAppointment | null, now: number): Fact[] {
  const a = classify(toAtt(p), now);
  const w = latestValidWeight(p);
  const f: Fact[] = [];
  f.push({ key: "nome", label: "Paciente", value: p.name ?? "Sem nome", source: "Cadastro", patientId: p.id });
  f.push(
    w
      ? { key: "peso", label: "Peso atual", value: `${fmtNum(w.kg)} kg`, source: w.at ? `Última medida válida · ${fmtDay(w.at)}` : "Cadastro" , patientId: p.id }
      : { key: "peso", label: "Peso atual", value: "Sem medida válida", source: "Peso", uncertain: true, patientId: p.id },
  );
  if (p.targetWeight != null) f.push({ key: "meta", label: "Meta de peso", value: `${fmtNum(p.targetWeight)} kg`, source: "Cadastro", patientId: p.id });
  if (w && p.heightCm) {
    const cm = p.heightCm < 3 ? p.heightCm * 100 : p.heightCm;
    if (cm >= 50 && cm <= 260) f.push({ key: "imc", label: "IMC", value: fmtNum(w.kg / (cm / 100) ** 2), source: "Calculado pelo sistema", patientId: p.id });
  }
  f.push(
    p.rate != null
      ? { key: "adesao", label: "Adesão na semana", value: `${Math.round(p.rate)}%`, source: "App do paciente", patientId: p.id }
      : { key: "adesao", label: "Adesão na semana", value: "Sem dado de adesão", source: "App do paciente", uncertain: true, patientId: p.id },
  );
  f.push({
    key: "ultimo_registro",
    label: "Último registro (peso, foto, treino ou app)",
    value: a.since == null ? "Ainda não registrou no app" : a.since === 0 ? "Hoje" : `Há ${a.since} ${a.since === 1 ? "dia" : "dias"}`,
    source: "App do paciente",
    uncertain: a.since == null,
    patientId: p.id,
    reason: a.reasons[0]?.kind ?? null,
  });
  // Mesmos "Sinais recentes" da ficha (cálculo diário de adesão), para o resumo não mostrar um número e a ficha outro.
  if (p.riskFactors?.length) f.push({ key: "sinais", label: "Sinais recentes", value: p.riskFactors.join("; "), source: "Sinais recentes da ficha", patientId: p.id });
  f.push({ key: "objetivo", label: "Objetivo", value: p.goal?.trim() || "Não informado", source: "Cadastro", uncertain: !p.goal?.trim(), patientId: p.id });
  if (a.reasons.length) f.push({ key: "motivos", label: "Motivos de atenção", value: a.reasons.map((r) => r.label).join("; "), source: "Foco do dia", patientId: p.id, reason: a.reasons[0].kind });
  f.push(
    nextAppt
      ? { key: "proximo", label: "Próximo compromisso", value: `${fmtDay(nextAppt.startsAt)} ${fmtTime(nextAppt.startsAt)} · ${nextAppt.title}`, source: "Agenda", patientId: p.id }
      : { key: "proximo", label: "Próximo compromisso", value: "Nada marcado", source: "Agenda", uncertain: true, patientId: p.id },
  );
  return f;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/** Paciente citado pelo primeiro nome na mensagem (entre os já permitidos). */
export function findPatientByName(message: string, names: Array<{ id: string; name: string | null }>): string | null {
  const n = norm(message);
  const hits = names.filter((p) => p.name && new RegExp(`\\b${norm(p.name.split(/\s+/)[0])}\\b`).test(n));
  return hits.length === 1 ? hits[0].id : null;
}

export function actionFor(patientId: string, reason: Fact["reason"]): { label: string; to: string } {
  switch (reason) {
    case "adherence_drop": return { label: ACTION_LABEL.adherence_drop, to: `/pacientes/${patientId}` };
    case "no_record": return { label: ACTION_LABEL.no_record, to: `/mensagens?patient=${patientId}` };
    case "never_registered": return { label: ACTION_LABEL.never_registered, to: `/mensagens?patient=${patientId}` };
    default: return { label: "Abrir ficha", to: `/pacientes/${patientId}` };
  }
}

const SCREENS: ScreenKey[] = ["hoje", "pacientes", "paciente", "agenda", "jornada", "relacionamento", "gestao", "biblioteca", "configuracoes", "outra"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABELS: Record<ScreenKey, string> = {
  hoje: "Hoje", pacientes: "Pacientes", paciente: "Ficha do paciente", agenda: "Agenda", jornada: "Jornada",
  relacionamento: "Relacionamento", gestao: "Gestão", biblioteca: "Biblioteca", configuracoes: "Configurações", outra: "Vertexa",
};

/** Contexto de tela vindo do navegador: só aceita valores conhecidos (nunca texto livre no prompt). */
export function sanitizeScreen(raw: unknown): ScreenContext {
  const r = (raw ?? {}) as Partial<ScreenContext>;
  const screen = SCREENS.includes(r.screen as ScreenKey) ? (r.screen as ScreenKey) : "outra";
  const patientId = typeof r.patientId === "string" && UUID.test(r.patientId) ? r.patientId : null;
  return {
    screen: screen === "paciente" && !patientId ? "outra" : screen,
    label: LABELS[screen],
    patientId: screen === "paciente" ? patientId : null,
    tab: typeof r.tab === "string" && /^[a-z_]{1,24}$/.test(r.tab) ? r.tab : null,
  };
}
