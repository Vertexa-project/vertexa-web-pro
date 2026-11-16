/** PDFs de plano enviados ao app do paciente (redesign P6): treino e plano alimentar com a marca da clínica (logo, nome e cor). */
import { StyleSheet, Text, View } from "@react-pdf/renderer";

import { DataTable, Document, EmptyState, ReportShell, SectionTitle, type ReportBrand } from "./primitives";
import { FONT, NEUTRAL, SP } from "./theme";
import { formatReps } from "@/lib/domain/workoutDisplay";
import { formatNumber } from "@/lib/domain/format";
import { isoDateBRText } from "@/lib/domain/patientReminders";

const st = StyleSheet.create({
  note: { fontSize: 8.5, color: NEUTRAL.inkSoft, marginTop: SP.sm },
  instr: { fontSize: 8.5, color: NEUTRAL.inkSoft, marginTop: 2 },
  name: { fontSize: 9.5, color: NEUTRAL.ink, fontFamily: FONT.display, fontWeight: 700 },
  total: { fontSize: 10, color: NEUTRAL.ink, fontFamily: FONT.display, fontWeight: 700, marginTop: SP.md, textAlign: "right" },
  optTitle: { fontSize: 8, color: NEUTRAL.inkFaint, marginTop: 3 },
});

export interface PlanPdfContext {
  brand: ReportBrand;
  clinicName: string;
  patientName: string;
  professionalName: string | null;
  /** AAAA-MM-DD (Brasília) */
  emittedIso: string;
}

export interface WorkoutPdfExercise {
  name: string;
  sets: number | null;
  reps: number | string | null;
  load_kg: number | null;
  rest_seconds: number | null;
  notes: string | null;
}
export interface WorkoutPdfDay {
  letter: string | null;
  name: string;
  minutes: number | null;
  exercises: WorkoutPdfExercise[];
}

const restText = (s: number | null) => (s == null || s <= 0 ? "—" : s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);

export function WorkoutPlanPdf({ ctx, title, goal, days }: { ctx: PlanPdfContext; title: string; goal: string | null; days: WorkoutPdfDay[] }) {
  return (
    <Document title={`Treino — ${ctx.patientName}`} author={ctx.clinicName} subject="Plano de treino" creator="VERTEXA">
      <ReportShell
        brand={ctx.brand}
        eyebrow="Plano de treino"
        patientName={ctx.patientName}
        subtitle={[title, goal].filter(Boolean).join(" · ")}
        identity={[
          { label: "Profissional", value: ctx.professionalName ?? "—" },
          { label: "Clínica", value: ctx.clinicName },
          { label: "Dias de treino", value: String(days.length) },
          { label: "Emitido em", value: isoDateBRText(ctx.emittedIso) },
        ]}
        clinicName={ctx.clinicName}
        emittedAt={isoDateBRText(ctx.emittedIso)}
        footerLabel="Plano de treino"
      >
        {days.length === 0 ? <EmptyState text="Plano sem treinos." /> : null}
        {days.map((d, i) => (
          <View key={i} wrap={false}>
            <SectionTitle title={`${d.letter ? `${d.letter} · ` : ""}${d.name}`} hint={d.minutes ? `${d.minutes} min` : undefined} />
            <DataTable
              columns={[
                { key: "ex", label: "Exercício", flex: 3.2 },
                { key: "sr", label: "Séries × Reps", flex: 1.3 },
                { key: "ld", label: "Carga", flex: 1 },
                { key: "rt", label: "Intervalo", flex: 1 },
              ]}
              rows={d.exercises.map((e) => ({
                ex: (
                  <View>
                    <Text style={st.name}>{e.name}</Text>
                    {e.notes?.trim() ? <Text style={st.instr}>{e.notes.trim()}</Text> : null}
                  </View>
                ),
                sr: `${e.sets != null ? formatNumber(e.sets, 0) : "—"} × ${formatReps(e.reps) ?? "—"}`,
                ld: e.load_kg != null && e.load_kg > 0 ? `${formatNumber(e.load_kg, 1)} kg` : "—",
                rt: restText(e.rest_seconds),
              }))}
            />
          </View>
        ))}
        <Text style={st.note}>Abra o treino no app para ver a animação de cada exercício. Qualquer dia da semana pode ser usado.</Text>
      </ReportShell>
    </Document>
  );
}

export interface NutritionPdfMeal {
  time: string | null;
  name: string | null;
  items: string[];
  calories: number | null;
  options: Array<{ items: string[]; calories: number | null }>;
}

export function NutritionPlanPdf({ ctx, title, meals }: { ctx: PlanPdfContext; title: string; meals: NutritionPdfMeal[] }) {
  const total = meals.reduce((a, m) => a + (m.calories ?? 0), 0);
  return (
    <Document title={`Plano alimentar — ${ctx.patientName}`} author={ctx.clinicName} subject="Plano alimentar" creator="VERTEXA">
      <ReportShell
        brand={ctx.brand}
        eyebrow="Plano alimentar"
        patientName={ctx.patientName}
        subtitle={title}
        identity={[
          { label: "Profissional", value: ctx.professionalName ?? "—" },
          { label: "Clínica", value: ctx.clinicName },
          { label: "Refeições", value: String(meals.length) },
          { label: "Emitido em", value: isoDateBRText(ctx.emittedIso) },
        ]}
        clinicName={ctx.clinicName}
        emittedAt={isoDateBRText(ctx.emittedIso)}
        footerLabel="Plano alimentar"
      >
        <SectionTitle title="Refeições" hint={total > 0 ? `${formatNumber(total, 0)} kcal no dia` : undefined} />
        {meals.length === 0 ? (
          <EmptyState text="Plano sem refeições." />
        ) : (
          <DataTable
            columns={[
              { key: "hr", label: "Hora", flex: 0.8 },
              { key: "rf", label: "Refeição", flex: 3.4 },
              { key: "kc", label: "kcal", flex: 0.8, align: "right" },
            ]}
            rows={meals.map((m) => ({
              hr: m.time ?? "—",
              rf: (
                <View>
                  <Text style={st.name}>{m.name ?? "Refeição"}</Text>
                  <Text style={st.instr}>{m.items.length ? m.items.join(" · ") : "—"}</Text>
                  {m.options.map((o, i) => (
                    <View key={i}>
                      <Text style={st.optTitle}>{`Opção ${i + 2}${o.calories != null ? ` · ${formatNumber(o.calories, 0)} kcal` : ""}`}</Text>
                      <Text style={st.instr}>{o.items.join(" · ")}</Text>
                    </View>
                  ))}
                </View>
              ),
              kc: m.calories != null ? formatNumber(m.calories, 0) : "—",
            }))}
          />
        )}
        {total > 0 ? <Text style={st.total}>Total: {formatNumber(total, 0)} kcal</Text> : null}
      </ReportShell>
    </Document>
  );
}
