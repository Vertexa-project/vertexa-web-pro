// PDF do treino / plano alimentar preparado UMA vez: o mesmo arquivo serve a prévia e o envio, e começa a ser montado
// antes do diálogo abrir (ao passar o mouse, focar ou tocar no botão). Carregamentos pesados (@react-pdf, fontes, pdf.js,
// marca da clínica) correm em paralelo e ficam em cache.
import { preloadPdfRenderer } from "@/components/patient/docimport/pdfRenderer";
import type { NutritionPlanFull, WorkoutPlanFull } from "@/types/db";

export type PlanPdfKind = "treino" | "plano_alimentar";
export interface PlanPdfWho {
  patientName: string;
  professionalName: string | null;
}

const MAX_ENTRIES = 4;
const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; blob: Promise<Blob> }>();

/** Chave do arquivo: tipo + conteúdo do plano + quem aparece no PDF (plano editado = outro PDF). */
export function planPdfKey(kind: PlanPdfKind, plan: unknown, who: PlanPdfWho): string {
  return JSON.stringify([kind, plan, who.patientName, who.professionalName]);
}

type Loader = () => Promise<typeof import("./generatePlanPdf")>;
const defaultLoader: Loader = () => import("./generatePlanPdf");

/** Aquece o que não depende do plano (módulo do PDF, fontes, marca, pdf.js). Seguro de chamar várias vezes. */
export function warmPdfEngines(load: Loader = defaultLoader): void {
  void load().then((m) => m.warmPlanPdfContext()).catch(() => undefined);
  void preloadPdfRenderer().catch(() => undefined);
}

export function preparePlanPdf(kind: PlanPdfKind, plan: WorkoutPlanFull | NutritionPlanFull, who: PlanPdfWho, load: Loader = defaultLoader): Promise<Blob> {
  const key = planPdfKey(kind, plan, who);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.blob;
  warmPdfEngines(load);
  const blob = load().then((m) =>
    kind === "treino" ? m.buildWorkoutPdf(plan as WorkoutPlanFull, who) : m.buildNutritionPdf(plan as NutritionPlanFull, who),
  );
  cache.set(key, { at: Date.now(), blob });
  blob.catch(() => cache.delete(key)); // falhou: a próxima tentativa refaz
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return blob;
}

export function clearPlanPdfCache(): void {
  cache.clear();
}
