import { pdf } from "@react-pdf/renderer";

import { EncounterReportDoc } from "./EncounterReport";
import { registerReportFonts } from "./fonts";
import { loadReportBrand } from "./reportBrand";
import { encounterPdfFilename, type EncounterPdfData } from "@/lib/clinical/pdfModel";

export async function generateEncounterReportBlob(data: EncounterPdfData): Promise<Blob> {
  registerReportFonts();
  const brand = await loadReportBrand();
  return pdf(<EncounterReportDoc data={data} brand={brand} />).toBlob();
}

/** Gera e baixa o PDF (100% no navegador, como os outros relatórios). */
export async function downloadEncounterReport(data: EncounterPdfData, startedAtIso: string): Promise<void> {
  const blob = await generateEncounterReportBlob(data);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = encounterPdfFilename(data.patientName, startedAtIso);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
