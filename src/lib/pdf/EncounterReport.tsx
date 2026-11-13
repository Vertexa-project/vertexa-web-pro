/** PDF do atendimento finalizado (prontuário). Casca e identidade reaproveitam os primitivos dos relatórios. */
import { StyleSheet, Text, View } from "@react-pdf/renderer";

import { Document, ReportShell, SectionTitle, type ReportBrand } from "./primitives";
import { BRAND, FONT, NEUTRAL, SP, STATUS } from "./theme";
import type { EncounterPdfData } from "@/lib/clinical/pdfModel";

const st = StyleSheet.create({
  demo: {
    backgroundColor: STATUS.warningTint,
    borderLeftWidth: 3,
    borderLeftColor: STATUS.warning,
    padding: SP.md,
    marginBottom: SP.md,
  },
  demoText: { fontSize: 9, color: STATUS.warningText, fontFamily: FONT.display, fontWeight: 700 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: NEUTRAL.hair, paddingVertical: SP.sm },
  label: { width: 150, paddingRight: SP.md, fontSize: 8.5, color: NEUTRAL.inkSoft, fontFamily: FONT.display, fontWeight: 700 },
  value: { flex: 1, fontSize: 9.5, color: NEUTRAL.ink },
  line: { marginBottom: 2 },
  addendum: { backgroundColor: NEUTRAL.surfaceAlt, padding: SP.md, marginBottom: SP.md, borderRadius: 4 },
  addMeta: { fontSize: 8, color: NEUTRAL.inkSoft, marginBottom: 2 },
  sign: { marginTop: SP.xxl, paddingTop: SP.md, borderTopWidth: 1, borderTopColor: NEUTRAL.hairStrong },
  signName: { fontFamily: FONT.display, fontWeight: 700, fontSize: 11, color: NEUTRAL.ink },
  signMeta: { fontSize: 9, color: NEUTRAL.inkSoft, marginTop: 2 },
  accent: { color: BRAND.orangeDeep },
});

export function EncounterReportDoc({ data, brand }: { data: EncounterPdfData; brand?: ReportBrand | null }) {
  return (
    <Document title={`Prontuário — ${data.patientName}`} author={data.clinicName} subject="Prontuário do atendimento" creator="VERTEXA">
      <ReportShell
        brand={brand}
        eyebrow="Prontuário do atendimento"
        patientName={data.patientName}
        subtitle={`Atendimento de ${data.startedAt}`}
        identity={[
          { label: "Profissional", value: data.professionalName },
          { label: "Clínica", value: data.clinicName },
          { label: "Início", value: data.startedAt },
          { label: "Finalizado em", value: data.finalizedAt ?? "—" },
        ]}
        clinicName={data.clinicName}
        emittedAt={data.emittedAt}
        footerLabel="Prontuário"
      >
        {data.demo ? (
          <View style={st.demo}>
            <Text style={st.demoText}>DEMONSTRAÇÃO — conteúdo simulado (consulta fictícia), sem valor clínico.</Text>
          </View>
        ) : null}
        {data.sections.map((s) => (
          <View key={s.title}>
            <SectionTitle title={s.title} />
            {s.rows.map((r) => (
              <View key={r.label} style={st.row} wrap={false}>
                <Text style={st.label}>{r.label}</Text>
                <View style={st.value}>
                  {r.lines.map((l, i) => (
                    <Text key={i} style={st.line}>
                      {r.lines.length > 1 ? `• ${l}` : l}
                    </Text>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ))}
        {data.addenda.length > 0 ? (
          <View>
            <SectionTitle title="Adendos" hint="correções posteriores à finalização" />
            {data.addenda.map((a, i) => (
              <View key={i} style={st.addendum} wrap={false}>
                <Text style={st.addMeta}>
                  {a.author} · {a.date}
                </Text>
                <Text>{a.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={st.sign} wrap={false}>
          <Text style={st.signName}>{data.professionalName}</Text>
          {data.professional
            .filter((p) => p.label !== "Nome")
            .map((p) => (
              <Text key={p.label} style={st.signMeta}>
                {p.label}: {p.value}
              </Text>
            ))}
        </View>
      </ReportShell>
    </Document>
  );
}
