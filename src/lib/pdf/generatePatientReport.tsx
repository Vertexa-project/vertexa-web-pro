/**
 * Orquestra o Relatório do Paciente (WP-REPORT A). O ÚNICO caminho para o pacote agregado é a RPC
 * export_patient_report (que autoriza + audita + retorna). A partir do JSON: monta o modelo, resolve
 * as fotos por URL assinada (bucket privado) → data URI, gera o Blob e dispara o download. Sem outra
 * fonte de dados; sem service_role.
 */
import { pdf } from "@react-pdf/renderer";

import { PatientReportDoc, type PatientReportPhotos } from "./PatientReport";
import { buildPatientReportModel } from "./patientReportModel";
import { registerReportFonts } from "./fonts";
import { urlToDataUri } from "./images";
import { loadReportBrand } from "./reportBrand";
import { buildPairs, POSE_LABEL } from "@/lib/domain/photoPose";
import { exportPatientReport, type ReportExportInput, type ReportExportResponse } from "@/lib/api/report";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/domain/format";

const PROGRESS_PHOTOS_BUCKET = "progress-photos";
const SIGNED_URL_TTL_SECONDS = 600;

function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .toLowerCase() || "paciente"
  );
}

export function patientReportFilename(patientName: string, now: Date): string {
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `relatorio-${slugify(patientName)}-${ymd}.pdf`;
}

/** Resolve a URL assinada de uma foto do bucket privado (fallback ao photo_url legado). */
async function resolvePhotoUri(storagePath: string | null, photoUrl: string | null): Promise<string | null> {
  if (storagePath) {
    const { data } = await supabase.storage.from(PROGRESS_PHOTOS_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (data?.signedUrl) return urlToDataUri(data.signedUrl);
  }
  return urlToDataUri(photoUrl);
}

/**
 * Um par antes/depois POR POSIÇÃO (frente, lado, costas): a mais antiga × a mais recente DA MESMA posição
 * no período — nunca frente × costas. Fotos antigas sem posição formam o grupo "Sem posição" (comportamento
 * anterior). Só rotula por posição quando há alguma foto classificada.
 */
async function buildPhotoPairs(model: ReturnType<typeof buildPatientReportModel>): Promise<PatientReportPhotos | null> {
  const dated = model.photos.filter((p) => p.takenAt).map((p) => ({ ...p, taken_at: p.takenAt }));
  const pairs = buildPairs(dated);
  if (pairs.length === 0) return null;
  const labelled = pairs.some((p) => p.pose !== "none");
  const out = await Promise.all(
    pairs.map(async (pair) => {
      const [beforeUri, afterUri] = await Promise.all([
        pair.before ? resolvePhotoUri(pair.before.storagePath, pair.before.photoUrl) : Promise.resolve(null),
        resolvePhotoUri(pair.after.storagePath, pair.after.photoUrl),
      ]);
      return {
        label: labelled ? POSE_LABEL[pair.pose] : null,
        before: { uri: beforeUri, caption: pair.before ? formatDate(pair.before.takenAt as string) : "—" },
        after: { uri: afterUri, caption: formatDate(pair.after.takenAt as string) },
      };
    }),
  );
  return out;
}

export async function generatePatientReportBlob(rpc: ReportExportResponse, now: Date): Promise<{ blob: Blob; patientName: string }> {
  const model = buildPatientReportModel(rpc, now);
  const [photos, brand] = await Promise.all([buildPhotoPairs(model), loadReportBrand()]);
  registerReportFonts();
  const blob = await pdf(<PatientReportDoc model={model} photos={photos} brand={brand} />).toBlob();
  return { blob, patientName: model.patientName };
}

/** Fluxo completo: RPC (autoriza+audita) → modelo → PDF → download. Erros propagam ao chamador. */
export async function downloadPatientReport(input: ReportExportInput, now: Date = new Date()): Promise<void> {
  const rpc = await exportPatientReport(input);
  const { blob, patientName } = await generatePatientReportBlob(rpc, now);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = patientReportFilename(patientName, now);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
