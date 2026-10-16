// Transforma o JSON da RPC public.export_patient_report no MODELO do PDF (puro/testável).
// A RPC é a ÚNICA fonte do pacote; aqui só formatamos para a casca (ReportShell/primitivos).
// A4 (obrigatório): quando meta.truncated, expõe um aviso legível para o leitor do relatório.
import type { ReportExportResponse } from "@/lib/api/report";

export interface ReportColumn {
  key: string;
  label: string;
  flex?: number;
  align?: "left" | "right" | "center";
}
export interface ReportSectionView {
  key: string;
  title: string;
  table?: { columns: ReportColumn[]; rows: Array<Record<string, string>> };
  kpis?: Array<{ label: string; value: string; sub?: string }>;
  emptyText?: string;
}
export interface ReportPhotoMeta {
  takenAt: string | null;
  storagePath: string | null;
  photoUrl: string | null;
}
export interface PatientReportModel {
  patientName: string;
  identity: Array<{ label: string; value: string }>;
  periodLabel: string;
  emittedAt: string;
  clinicName: string;
  recordCount: number;
  truncated: boolean;
  /** A4 — aviso legível quando registros foram omitidos por limite de volume. null quando não truncou. */
  truncationNotice: string | null;
  sections: ReportSectionView[];
  photos: ReportPhotoMeta[];
}

function fmtD(s: unknown): string {
  if (!s || typeof s !== "string") return "—";
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  if (isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function num(v: unknown, suffix = ""): string {
  if (v == null || v === "") return "—";
  return `${v}${suffix}`;
}
const arr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);


const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_WEEKS = 8; // tabelas semanais/sessões cabem numa página (seção não quebra)
const RECENT_SESSIONS = 8;

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
/** Número curto, sem zeros à toa: 2 → "2", 2.50 → "2.5" (mesmo separador do restante do PDF). */
const dec = (n: number, digits = 1): string => String(Math.round(n * 10 ** digits) / 10 ** digits);
const signed = (n: number, digits = 1): string => {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  if (r === 0) return "sem variação";
  return `${r > 0 ? "+" : "−"}${dec(Math.abs(r), digits)}`;
};
const dayMs = (s: string): number => new Date(s.length <= 10 ? `${s}T00:00:00` : s).getTime();
/** Segunda-feira (YYYY-MM-DD) da semana do dia informado — chave estável para agrupar por semana. */
function weekStart(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  return new Date(d.getTime() - dow * DAY_MS).toISOString().slice(0, 10);
}
const fmtWeek = (ymd: string): string => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
/** Dias corridos do período (inclusive), a partir de meta.from/meta.to. */
function periodDays(from: string, to: string): number {
  const a = dayMs(from);
  const b = dayMs(to);
  if (isNaN(a) || isNaN(b) || b < a) return 0;
  return Math.round((b - a) / DAY_MS) + 1;
}

/** Monta o modelo do relatório a partir do retorno da RPC. `now` injetável para determinismo/testes. */
export function buildPatientReportModel(rpc: ReportExportResponse, now: Date = new Date()): PatientReportModel {
  const meta = rpc.meta;
  const p = obj(rpc.patient) ?? {};
  const sec = rpc.sections ?? {};
  const clinicName = (obj(p.clinic)?.name as string) || "Clínica";
  const patientName = (p.full_name as string) || "Paciente";
  const periodLabel = `${fmtD(meta.from)} – ${fmtD(meta.to)}`;
  const emittedAt = fmtD(now.toISOString());

  const identity: Array<{ label: string; value: string }> = [
    { label: "Profissional", value: meta.exported_by?.name ?? "—" },
    { label: "Clínica", value: clinicName },
    { label: "Período", value: periodLabel },
    { label: "Objetivo", value: (p.goal as string) || "—" },
  ];

  const sections: ReportSectionView[] = [];
  const push = (v: ReportSectionView) => sections.push(v);

  // Evolução no período: início → fim do que veio nos dados (peso e % de gordura). Só mostra o que existe.
  {
    const w = arr(sec.weight)
      .map((x) => ({ at: dayMs(String(x.measured_at)), kg: toNum(x.weight_kg) }))
      .filter((x): x is { at: number; kg: number } => !isNaN(x.at) && x.kg != null)
      .sort((a, b) => a.at - b.at);
    const a = arr(sec.anthropometry)
      .map((x) => ({ at: dayMs(String(x.assessed_at)), fat: toNum(x.body_fat_pct) }))
      .filter((x) => !isNaN(x.at))
      .sort((p, q) => p.at - q.at);
    const fats = a.filter((x): x is { at: number; fat: number } => x.fat != null);
    const kpis: Array<{ label: string; value: string; sub?: string }> = [];
    if (w.length >= 2) // Sem seta "→": a fonte do PDF não tem o glifo e ela some. Valor final + variação desde o início.
    kpis.push({ label: "Peso", value: `${dec(w[w.length - 1].kg)} kg`, sub: `${signed(w[w.length - 1].kg - w[0].kg)} kg desde ${dec(w[0].kg)} kg` });
    else if (w.length === 1) kpis.push({ label: "Peso", value: `${dec(w[0].kg)} kg`, sub: "1 registro" });
    if (fats.length >= 2) kpis.push({ label: "% Gordura", value: `${dec(fats[fats.length - 1].fat)}%`, sub: `${signed(fats[fats.length - 1].fat - fats[0].fat)} p.p. desde ${dec(fats[0].fat)}%` });
    else if (fats.length === 1) kpis.push({ label: "% Gordura", value: `${dec(fats[0].fat)}%`, sub: "1 avaliação" });
    if (w.length || a.length) kpis.push({ label: "Medições", value: `${w.length} ${w.length === 1 ? "pesagem" : "pesagens"}`, sub: `${a.length} ${a.length === 1 ? "avaliação" : "avaliações"}` });
    if (kpis.length) push({ key: "evolution", title: "Evolução no período", kpis });
  }

  if ("weight" in sec) {
    const rows = arr(sec.weight).map((w) => ({ date: fmtD(w.measured_at), weight: num(w.weight_kg, " kg"), source: (w.source as string) || "—" }));
    push(rows.length
      ? { key: "weight", title: "Peso", table: { columns: [{ key: "date", label: "Data" }, { key: "weight", label: "Peso", align: "right" }, { key: "source", label: "Origem" }], rows } }
      : { key: "weight", title: "Peso", emptyText: "Sem registros de peso no período." });
  }
  if ("anthropometry" in sec) {
    const rows = arr(sec.anthropometry).map((a) => ({ date: fmtD(a.assessed_at), method: (a.method as string) || "—", weight: num(a.weight, " kg"), fat: num(a.body_fat_pct, "%") }));
    push(rows.length
      ? { key: "anthropometry", title: "Antropometria e composição", table: { columns: [{ key: "date", label: "Data" }, { key: "method", label: "Método" }, { key: "weight", label: "Peso", align: "right" }, { key: "fat", label: "% Gordura", align: "right" }], rows } }
      : { key: "anthropometry", title: "Antropometria e composição", emptyText: "Sem avaliações no período." });
  }
  if ("adherence" in sec) {
    const a = obj(sec.adherence);
    push(a
      ? { key: "adherence", title: "Adesão (VRI)", kpis: [
          { label: "Score", value: num(a.score) },
          { label: "Nível", value: (a.level as string) || "—" },
          { label: "Sequência", value: num(a.streak, " dias") },
          { label: "Conclusão semanal", value: num(a.weekly_completion_rate, "%") },
        ] }
      : { key: "adherence", title: "Adesão (VRI)", emptyText: "Sem snapshot de adesão." });
  }
  if ("workout_plan" in sec) {
    const wp = obj(sec.workout_plan);
    const workouts = arr(wp?.workouts);
    push(wp
      ? { key: "workout_plan", title: `Plano de treino${wp.title ? ` — ${wp.title}` : ""}`, table: {
          columns: [{ key: "letter", label: "Dia" }, { key: "name", label: "Treino" }, { key: "muscle", label: "Grupo" }, { key: "ex", label: "Exercícios", align: "right" }],
          rows: workouts.map((w) => ({ letter: (w.letter as string) || "—", name: (w.name as string) || "—", muscle: (w.primary_muscle_group as string) || "—", ex: String(arr(w.exercises).length) })),
        } }
      : { key: "workout_plan", title: "Plano de treino", emptyText: "Sem plano de treino ativo." });
  }
  if ("nutrition_plan" in sec) {
    const np = obj(sec.nutrition_plan);
    const meals = arr(np?.meals);
    push(np
      ? { key: "nutrition_plan", title: `Plano alimentar${np.title ? ` — ${np.title}` : ""}`, table: {
          columns: [{ key: "time", label: "Horário" }, { key: "name", label: "Refeição" }, { key: "cal", label: "Calorias", align: "right" }],
          rows: meals.map((m) => ({ time: (m.time as string) || "—", name: (m.name as string) || "—", cal: num(m.calories, " kcal") })),
        } }
      : { key: "nutrition_plan", title: "Plano alimentar", emptyText: "Sem plano alimentar ativo." });
  }
  if ("supplements" in sec) {
    const rows = arr(sec.supplements).map((x) => ({ name: (x.name as string) || "—", dose: (x.dose as string) || "—", time: (x.time_label as string) || "—" }));
    push(rows.length
      ? { key: "supplements", title: "Suplementos", table: { columns: [{ key: "name", label: "Nome" }, { key: "dose", label: "Dose" }, { key: "time", label: "Horário" }], rows } }
      : { key: "supplements", title: "Suplementos", emptyText: "Sem suplementos." });
  }
  if ("recovery" in sec) {
    const rows = arr(sec.recovery).map((r) => ({ muscle: (r.muscle_group as string) || "—", status: (r.status as string) || "—", last: fmtD(r.last_trained_at) }));
    push(rows.length
      ? { key: "recovery", title: "Recuperação muscular", table: { columns: [{ key: "muscle", label: "Grupo" }, { key: "status", label: "Estado" }, { key: "last", label: "Último treino" }], rows } }
      : { key: "recovery", title: "Recuperação muscular", emptyText: "Sem dados de recuperação." });
  }
  const nDays = periodDays(meta.from, meta.to);

  if ("workout_execution" in sec) {
    const list = arr(sec.workout_execution);
    if (list.length) {
      const durs = list.map((e) => toNum(e.total_duration_min)).filter((n): n is number => n != null);
      const perWeek = nDays > 0 ? list.length / (nDays / 7) : null;
      const kpis: Array<{ label: string; value: string; sub?: string }> = [{ label: "Treinos concluídos", value: String(list.length) }];
      if (durs.length) kpis.push({ label: "Duração média", value: `${Math.round(durs.reduce((a, b) => a + b, 0) / durs.length)} min` });
      if (perWeek != null) kpis.push({ label: "Frequência", value: `${dec(perWeek)}/semana`, sub: `em ${nDays} dias` });
      const recent = [...list].sort((a, b) => dayMs(String(b.performed_on)) - dayMs(String(a.performed_on))).slice(0, RECENT_SESSIONS);
      push({
        key: "workout_execution",
        title: "Execução de treino",
        kpis,
        table: {
          columns: [{ key: "date", label: "Data" }, { key: "name", label: "Treino" }, { key: "dur", label: "Duração", align: "right" }],
          rows: recent.map((e) => ({ date: fmtD(e.performed_on), name: (e.workout_name as string) || "—", dur: num(e.total_duration_min, " min") })),
        },
      });
    } else {
      push({ key: "workout_execution", title: "Execução de treino", emptyText: "Sem execuções no período." });
    }
  }

  if ("hydration" in sec) {
    const days = arr(sec.hydration)
      .map((h) => ({ day: String(h.day ?? ""), liters: toNum(h.liters) }))
      .filter((h): h is { day: string; liters: number } => h.day !== "" && h.liters != null);
    if (days.length) {
      const total = days.reduce((a, h) => a + h.liters, 0);
      const best = days.reduce((a, h) => (h.liters > a.liters ? h : a), days[0]);
      const weeks = new Map<string, { sum: number; n: number }>();
      for (const h of days) {
        const k = weekStart(h.day);
        const w = weeks.get(k) ?? { sum: 0, n: 0 };
        w.sum += h.liters;
        w.n += 1;
        weeks.set(k, w);
      }
      const rows = [...weeks.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .slice(-RECENT_WEEKS)
        .map(([k, w]) => ({ week: fmtWeek(k), avg: `${dec(w.sum / w.n)} L`, days: String(w.n) }));
      push({
        key: "hydration",
        title: "Hidratação",
        kpis: [
          { label: "Média por dia registrado", value: `${dec(total / days.length)} L` },
          { label: "Dias com registro", value: nDays > 0 ? `${days.length} de ${nDays}` : String(days.length) },
          { label: "Melhor dia", value: `${dec(best.liters)} L`, sub: fmtD(best.day) },
        ],
        table: { columns: [{ key: "week", label: "Semana de" }, { key: "avg", label: "Média/dia", align: "right" }, { key: "days", label: "Dias com registro", align: "right" }], rows },
      });
    } else {
      push({ key: "hydration", title: "Hidratação", emptyText: "Sem registros de água no período." });
    }
  }

  if ("supplement_intakes" in sec) {
    const days = arr(sec.supplement_intakes)
      .map((i) => ({ day: String(i.day ?? ""), taken: toNum(i.taken), total: toNum(i.total) }))
      .filter((i): i is { day: string; taken: number; total: number | null } => i.day !== "" && i.taken != null);
    if (days.length) {
      const taken = days.reduce((a, i) => a + i.taken, 0);
      const supplementsCount = Math.max(0, ...days.map((i) => i.total ?? 0));
      const possible = supplementsCount * nDays;
      const kpis: Array<{ label: string; value: string; sub?: string }> = [
        possible > 0 ? { label: "Doses marcadas", value: String(taken), sub: `de ${possible} possíveis` } : { label: "Doses marcadas", value: String(taken) },
      ];
      if (possible > 0) kpis.push({ label: "Adesão", value: `${Math.min(100, Math.round((taken / possible) * 100))}%` });
      kpis.push({ label: "Dias com marcação", value: nDays > 0 ? `${days.length} de ${nDays}` : String(days.length) });
      const weeks = new Map<string, { taken: number; n: number }>();
      for (const i of days) {
        const k = weekStart(i.day);
        const w = weeks.get(k) ?? { taken: 0, n: 0 };
        w.taken += i.taken;
        w.n += 1;
        weeks.set(k, w);
      }
      const rows = [...weeks.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .slice(-RECENT_WEEKS)
        .map(([k, w]) => ({ week: fmtWeek(k), taken: String(w.taken), days: String(w.n) }));
      push({
        key: "supplement_intakes",
        title: "Suplementação",
        kpis,
        table: { columns: [{ key: "week", label: "Semana de" }, { key: "taken", label: "Doses marcadas", align: "right" }, { key: "days", label: "Dias com marcação", align: "right" }], rows },
      });
    } else {
      push({ key: "supplement_intakes", title: "Suplementação", emptyText: "Sem marcações de suplementos no período." });
    }
  }

  if ("documents" in sec) {
    const rows = arr(sec.documents).map((d) => ({ date: fmtD(d.uploaded_at), kind: (d.kind as string) || "—", title: (d.title as string) || "—" }));
    push(rows.length
      ? { key: "documents", title: "Documentos", table: { columns: [{ key: "date", label: "Data" }, { key: "kind", label: "Tipo" }, { key: "title", label: "Título" }], rows } }
      : { key: "documents", title: "Documentos", emptyText: "Sem documentos no período." });
  }
  if ("appointments" in sec) {
    const rows = arr(sec.appointments).map((a) => ({ date: fmtD(a.starts_at), title: (a.title as string) || "—", type: (a.type as string) || "—", status: (a.status as string) || "—" }));
    push(rows.length
      ? { key: "appointments", title: "Consultas", table: { columns: [{ key: "date", label: "Data" }, { key: "title", label: "Título" }, { key: "type", label: "Tipo" }, { key: "status", label: "Status" }], rows } }
      : { key: "appointments", title: "Consultas", emptyText: "Sem consultas no período." });
  }
  if ("achievements" in sec) {
    const rows = arr(sec.achievements).map((a) => ({ date: fmtD(a.unlocked_at), title: (a.title as string) || (a.code as string) || "—" }));
    push(rows.length
      ? { key: "achievements", title: "Conquistas", table: { columns: [{ key: "date", label: "Data" }, { key: "title", label: "Conquista" }], rows } }
      : { key: "achievements", title: "Conquistas", emptyText: "Sem conquistas no período." });
  }
  if ("timeline" in sec) {
    const rows = arr(sec.timeline).map((t) => ({ date: fmtD(t.created_at), type: (t.type as string) || "—" }));
    push(rows.length
      ? { key: "timeline", title: "Atividades", table: { columns: [{ key: "date", label: "Data" }, { key: "type", label: "Evento" }], rows } }
      : { key: "timeline", title: "Atividades", emptyText: "Sem atividades no período." });
  }

  // Ordem de leitura do período: evolução → dados corporais → treino → alimentação/água → suplementos → adesão.
  const ORDER = ["evolution", "weight", "anthropometry", "workout_execution", "workout_plan", "nutrition_plan", "hydration", "supplements", "supplement_intakes", "adherence", "recovery", "documents", "appointments", "achievements", "timeline"];
  const rank = (k: string) => { const i = ORDER.indexOf(k); return i === -1 ? ORDER.length : i; };
  sections.sort((a, b) => rank(a.key) - rank(b.key));

  const photos: ReportPhotoMeta[] = arr(sec.photos).map((ph) => ({
    takenAt: (ph.taken_at as string) ?? null,
    storagePath: (ph.storage_path as string) ?? null,
    photoUrl: (ph.photo_url as string) ?? null,
  }));

  return {
    patientName,
    identity,
    periodLabel,
    emittedAt,
    clinicName,
    recordCount: meta.record_count ?? 0,
    truncated: Boolean(meta.truncated),
    truncationNotice: meta.truncated
      ? `Alguns registros foram omitidos por limite de volume — período: ${periodLabel}. Refine o período para um relatório completo.`
      : null,
    sections,
    photos,
  };
}
