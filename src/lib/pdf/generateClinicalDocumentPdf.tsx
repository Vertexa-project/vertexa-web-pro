import { pdf } from "@react-pdf/renderer";

import type { DocFull } from "@/lib/api/clinicalDocs";
import { DOC_TYPE_LABEL } from "@/lib/domain/clinicalDocs";
import { ClinicalDocumentPdf } from "./ClinicalDocumentPdf";

export const clinicalDocFilename = (doc: Pick<DocFull, "doc_type" | "is_demo" | "signed_at">): string =>
  `${DOC_TYPE_LABEL[doc.doc_type].toLowerCase()}${doc.is_demo ? "-demonstracao" : ""}-${doc.signed_at.slice(0, 10)}`;

export async function buildClinicalDocumentPdf(doc: DocFull): Promise<Blob> {
  return pdf(<ClinicalDocumentPdf doc={doc} />).toBlob();
}

/** Baixa o PDF no navegador (mesmo padrão dos demais PDFs). */
export async function downloadClinicalDocumentPdf(doc: DocFull): Promise<void> {
  const blob = await buildClinicalDocumentPdf(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${clinicalDocFilename(doc)}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
