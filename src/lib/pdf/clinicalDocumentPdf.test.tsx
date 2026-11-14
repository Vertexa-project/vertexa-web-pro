import { describe, expect, it } from "vitest";
import { pdf } from "@react-pdf/renderer";

import type { DocFull } from "@/lib/api/clinicalDocs";
import { clinicalDocFilename } from "./generateClinicalDocumentPdf";
import { ClinicalDocumentPdf } from "./ClinicalDocumentPdf";

const DOC: DocFull = {
  id: "d1", clinic_id: "c1", patient_id: "p1", patient_name: "Paciente Fictício", encounter_id: null, appointment_id: null, doc_type: "receita", title: "Receita — teste",
  signed_at: "2026-11-15T01:30:00Z", professional_name: "Profissional Fictício", professional_registry: "CRN-3 000001", provider: "demo", is_demo: true, sncr_number: null, item_count: 1,
  invalidated: false, invalidated_at: null, invalidated_reason: null, resend_count: 0, content: "Tomar em jejum.", clinic_name: "Clínica Fictícia", content_hash: "a".repeat(64),
  items: [{ name: "Medicamento Fictício", dose: "1 comprimido", posology: "1x ao dia", quantity: "30" }],
  patient: { name: "Paciente Fictício", birth_date: "1990-05-17", cpf: "11144477735", address: "Rua Fictícia, 1" },
  professional: { name: "Profissional Fictício", registry_number: "CRN-3 000001", specialty: "Nutrição" },
};

describe("PDF do documento clínico", () => {
  it("gera um PDF válido (receita de demonstração) e o nome do arquivo marca a demonstração", async () => {
    const buf = await pdf(<ClinicalDocumentPdf doc={DOC} />).toBuffer();
    const chunks: Buffer[] = [];
    for await (const c of buf as unknown as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1500);
    expect(clinicalDocFilename(DOC)).toBe("receita-demonstracao-2026-11-15");
    expect(clinicalDocFilename({ ...DOC, is_demo: false, doc_type: "atestado" })).toBe("atestado-2026-11-15");
  });
  it("documento invalidado, atestado sem itens e provedor real também geram PDF", async () => {
    for (const d of [{ ...DOC, invalidated: true, invalidated_at: "2026-11-16T10:00:00Z" }, { ...DOC, doc_type: "atestado" as const, items: [], content: "Repouso." }, { ...DOC, is_demo: false, provider: "memed", sncr_number: "N-1" }]) {
      const buf = await pdf(<ClinicalDocumentPdf doc={d} />).toBuffer();
      const chunks: Buffer[] = [];
      for await (const c of buf as unknown as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
      expect(Buffer.concat(chunks).subarray(0, 5).toString()).toBe("%PDF-");
    }
  });
});
