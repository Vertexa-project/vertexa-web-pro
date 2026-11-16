/** Gera (no navegador) o PDF de treino ou plano alimentar com a marca da clínica. A marca vem do cadastro da clínica (logo + cor + nome). */
import { pdf } from "@react-pdf/renderer";

import { NutritionPlanPdf, WorkoutPlanPdf, type NutritionPdfMeal, type PlanPdfContext, type WorkoutPdfDay } from "./PlanPdfs";
import { registerReportFonts } from "./fonts";
import { urlToDataUri } from "./images";
import { clinicLogoUrl, getMyClinicBrand } from "@/lib/api/clinicBrand";
import { pdfBrandOf } from "@/lib/domain/deliveries";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import type { NutritionPlanFull, WorkoutPlanFull } from "@/types/db";

export interface PlanPdfInput {
  patientName: string;
  professionalName: string | null;
  now?: Date;
}

async function loadContext(i: PlanPdfInput): Promise<PlanPdfContext> {
  const raw = await getMyClinicBrand().catch(() => null);
  const logoUri = raw?.logoPath ? await urlToDataUri(clinicLogoUrl(raw.logoPath)) : null;
  const b = pdfBrandOf({ name: raw?.name, color: raw?.color, logoUri });
  return {
    brand: { logoUri: b.logoUri, color: b.color },
    clinicName: b.clinicName,
    patientName: i.patientName,
    professionalName: i.professionalName,
    emittedIso: todayIsoBR(i.now ?? new Date()),
  };
}

export function workoutDays(plan: WorkoutPlanFull): WorkoutPdfDay[] {
  return plan.workouts
    .filter((w) => w.workout_exercises.length > 0)
    .map((w) => ({
      letter: w.letter,
      name: w.name,
      minutes: w.estimated_minutes,
      exercises: w.workout_exercises.map((e) => ({ name: e.name, sets: e.sets, reps: e.reps, load_kg: e.load_kg, rest_seconds: e.rest_seconds, notes: e.notes })),
    }));
}

export function nutritionMeals(plan: NutritionPlanFull): NutritionPdfMeal[] {
  return plan.meals.map((m) => ({ time: m.time, name: m.name, items: m.items ?? [], calories: m.calories, options: m.options ?? [] }));
}

export async function buildWorkoutPdf(plan: WorkoutPlanFull, i: PlanPdfInput): Promise<Blob> {
  const ctx = await loadContext(i);
  registerReportFonts();
  return pdf(<WorkoutPlanPdf ctx={ctx} title={plan.title} goal={plan.goal} days={workoutDays(plan)} />).toBlob();
}

export async function buildNutritionPdf(plan: NutritionPlanFull, i: PlanPdfInput): Promise<Blob> {
  const ctx = await loadContext(i);
  registerReportFonts();
  return pdf(<NutritionPlanPdf ctx={ctx} title={plan.title} meals={nutritionMeals(plan)} />).toBlob();
}
