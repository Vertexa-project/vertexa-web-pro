/** PDF do documento clínico (Entrega 9). Documento de demonstração leva a faixa «DEMONSTRAÇÃO — sem validade legal» em todas as páginas e marca d'água. */
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { DEMO_BADGE, DOC_TYPE_LABEL, dateTimeBR, formatCpf, isoDateBR } from "@/lib/domain/clinicalDocs";
import type { DocFull } from "@/lib/api/clinicalDocs";

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 54, paddingHorizontal: 40, fontSize: 10.5, fontFamily: "Helvetica", color: "#111" },
  demo: { position: "absolute", top: 14, left: 40, right: 40, textAlign: "center", fontSize: 10, fontWeight: 700, color: "#b91c1c", borderWidth: 1, borderColor: "#b91c1c", paddingVertical: 3 },
  mark: { position: "absolute", top: 330, left: 20, width: 560, textAlign: "center", fontSize: 40, fontWeight: 700, color: "#fca5a5", opacity: 0.35, transform: "rotate(-30deg)" },
  clinic: { fontSize: 12, fontWeight: 700 }, h1: { fontSize: 17, fontWeight: 700, marginTop: 10, marginBottom: 8 },
  box: { borderWidth: 0.7, borderColor: "#999", padding: 8, marginBottom: 10 }, lbl: { color: "#555", fontSize: 8.5 },
  body: { lineHeight: 1.45, marginTop: 4, marginBottom: 8 },
  item: { borderBottomWidth: 0.5, borderBottomColor: "#ccc", paddingVertical: 4 }, itemName: { fontWeight: 700 },
  sign: { marginTop: 36, alignItems: "center" }, line: { width: 260, borderTopWidth: 0.8, borderTopColor: "#111", marginBottom: 3 },
  inval: { color: "#b91c1c", fontWeight: 700, marginBottom: 6 },
  foot: { position: "absolute", bottom: 22, left: 40, right: 40, fontSize: 8, color: "#555", textAlign: "center" },
});

export function ClinicalDocumentPdf({ doc }: { doc: DocFull }) {
  const isReceita = doc.doc_type === "receita";
  const hasItems = doc.items.length > 0;
  return (
    <Document title={`${DOC_TYPE_LABEL[doc.doc_type]} — ${doc.patient.name}`}>
      <Page size="A4" style={s.page}>
        {doc.is_demo ? <Text style={s.demo} fixed>{DEMO_BADGE}</Text> : null}
        {doc.is_demo ? <Text style={s.mark} fixed>DEMONSTRAÇÃO</Text> : null}
        <Text style={s.clinic}>{doc.clinic_name}</Text>
        <Text style={s.h1}>{doc.title || DOC_TYPE_LABEL[doc.doc_type]}</Text>
        {doc.invalidated ? <Text style={s.inval}>DOCUMENTO INVALIDADO em {dateTimeBR(doc.invalidated_at)}</Text> : null}
        <View style={s.box}>
          <Text style={s.lbl}>Paciente</Text>
          <Text>{doc.patient.name}</Text>
          <Text style={s.lbl}>{`Nascimento ${isoDateBR(doc.patient.birth_date)}${doc.patient.cpf ? `   ·   CPF ${formatCpf(doc.patient.cpf)}` : ""}`}</Text>
          {doc.patient.address ? <Text style={s.lbl}>{doc.patient.address}</Text> : null}
        </View>
        {hasItems ? (
          <View>
            <Text style={s.lbl}>{isReceita ? "Prescrição" : "Itens solicitados"}</Text>
            {doc.items.map((it, i) => (
              <View key={i} style={s.item} wrap={false}>
                <Text style={s.itemName}>{`${i + 1}. ${it.name}`}</Text>
                {isReceita ? <Text>{`${it.dose} — ${it.posology} — Quantidade: ${it.quantity}`}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
        {doc.content.trim() ? <Text style={s.body}>{doc.content}</Text> : null}
        <View style={s.sign} wrap={false}>
          <View style={s.line} />
          <Text>{doc.professional.name}</Text>
          <Text style={s.lbl}>{[doc.professional.registry_number, doc.professional.specialty].filter(Boolean).join(" · ")}</Text>
          <Text style={s.lbl}>{`Assinado em ${dateTimeBR(doc.signed_at)}${doc.is_demo ? " (assinatura de demonstração)" : ""}${doc.sncr_number ? ` · SNCR ${doc.sncr_number}` : ""}`}</Text>
        </View>
        <Text style={s.foot} fixed>{`${doc.is_demo ? `${DEMO_BADGE} · ` : ""}Código ${doc.content_hash.slice(0, 16)}`}</Text>
      </Page>
    </Document>
  );
}
