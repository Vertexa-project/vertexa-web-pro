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
  if ("workout_execution" in sec) {
    const rows = arr(sec.workout_execution).map((e) => ({ date: fmtD(e.performed_on), name: (e.workout_name as string) || "—", dur: num(e.total_duration_min, " min") }));
    push(rows.length
      ? { key: "workout_execution", title: "Execução de treino", table: { columns: [{ key: "date", label: "Data" }, { key: "name", label: "Treino" }, { key: "dur", label: "Duração", align: "right" }], rows } }
      : { key: "workout_execution", title: "Execução de treino", emptyText: "Sem execuções no período." });
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
