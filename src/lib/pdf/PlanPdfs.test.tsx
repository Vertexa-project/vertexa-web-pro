import { describe, expect, it } from "vitest";
import path from "node:path";
import { Font, pdf } from "@react-pdf/renderer";

import { NutritionPlanPdf, WorkoutPlanPdf, type PlanPdfContext } from "./PlanPdfs";
import { pdfBrandOf } from "@/lib/domain/deliveries";

// Mesmas famílias do registerReportFonts, com os .woff direto do disco (o import do Vite vira URL e não existe no runner).
const fontFile = (pkg: string, f: string) => path.join(process.cwd(), "node_modules", "@fontsource", pkg, "files", f);
Font.register({ family: "Inter", fonts: [400, 500, 600, 700].map((w) => ({ src: fontFile("inter", `inter-latin-${w}-normal.woff`), fontWeight: w })) });
Font.register({ family: "PlusJakarta", fonts: [600, 700, 800].map((w) => ({ src: fontFile("plus-jakarta-sans", `plus-jakarta-sans-latin-${w}-normal.woff`), fontWeight: w })) });

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Metadado do PDF: UTF-16BE com marca de ordem (lido como latin1, cada letra vem precedida de um byte nulo).
const pdfText = (t: string): string => "\u00fe\u00ff" + Array.from(t).map((c) => `\u0000${c}`).join("");

async function bytesOf(doc: React.ReactElement): Promise<string> {
  const stream = await pdf(doc as never).toBuffer();
  const chunks: Buffer[] = [];
  for await (const c of stream as unknown as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("latin1");
}

const ctxOf = (logo: string | null, color: string | null): PlanPdfContext => {
  const b = pdfBrandOf({ name: "Clínica Ápice", color, logoUri: logo });
  return { brand: { logoUri: b.logoUri, color: b.color }, clinicName: b.clinicName, patientName: "Mariana Teste", professionalName: "Dra. Juliana", emittedIso: "2026-11-16" };
};

describe("PDF do plano com a marca da clínica", () => {
  it("treino: PDF válido, com a clínica como autora e a logo embutida", async () => {
    const days = [{ letter: "A", name: "Peito", minutes: 50, exercises: [{ name: "Supino reto", sets: 3, reps: 10, load_kg: 20, rest_seconds: 60, notes: "Desça devagar" }] }];
    const comLogo = await bytesOf(<WorkoutPlanPdf ctx={ctxOf(PNG, "#11764A")} title="Ficha de teste" goal="Força" days={days} />);
    const semLogo = await bytesOf(<WorkoutPlanPdf ctx={ctxOf(null, null)} title="Ficha de teste" goal={null} days={days} />);
    expect(comLogo.startsWith("%PDF-")).toBe(true);
    // O autor do PDF é o nome da clínica (campo Author do documento).
    expect(comLogo).toContain(pdfText("Clínica Ápice"));
    expect(semLogo).toContain(pdfText("Clínica Ápice"));
    expect(comLogo.length).toBeGreaterThan(semLogo.length);
    expect(comLogo).toContain("/Subtype /Image");
    expect(semLogo).not.toContain("/Subtype /Image");
  });
  it("plano alimentar: gera com opções, total de kcal e plano vazio sem quebrar", async () => {
    const meals = [{ time: "08:00", name: "Café da manhã", items: ["2 ovos", "1 fruta"], calories: 320, options: [{ items: ["Iogurte"], calories: 150 }] }];
    expect((await bytesOf(<NutritionPlanPdf ctx={ctxOf(null, "#F97316")} title="Plano de teste" meals={meals} />)).startsWith("%PDF-")).toBe(true);
    expect((await bytesOf(<NutritionPlanPdf ctx={ctxOf(null, null)} title="Vazio" meals={[]} />)).startsWith("%PDF-")).toBe(true);
    expect((await bytesOf(<WorkoutPlanPdf ctx={ctxOf(null, null)} title="Vazio" goal={null} days={[]} />)).startsWith("%PDF-")).toBe(true);
  });
});
