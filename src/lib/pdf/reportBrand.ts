import { clinicLogoUrl, getMyClinicBrand } from "@/lib/api/clinicBrand";
import type { ReportBrand } from "./primitives";
import { urlToDataUri } from "./images";

/**
 * Marca da clínica para o cabeçalho dos relatórios individuais. Qualquer falha (sem clínica, sem rede,
 * logo indisponível) devolve null e o relatório sai com a marca Vertexa — nunca quebra a exportação.
 */
export async function loadReportBrand(): Promise<ReportBrand | null> {
  try {
    const b = await getMyClinicBrand();
    if (!b || (!b.logoPath && !b.color)) return null;
    return { logoUri: await urlToDataUri(clinicLogoUrl(b.logoPath)), color: b.color };
  } catch {
    return null;
  }
}
