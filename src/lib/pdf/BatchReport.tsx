// Documento @react-pdf do Relatório em LOTE (WP-REPORT B): capa (quantos incluídos / quais falharam)
// + um bloco por paciente incluído. Reusa a casca (ReportShell) e o corpo por paciente
// (PatientReportSections). Sem embutir fotos no lote (limita o tamanho do arquivo — decisão documentada).
import { StyleSheet, Text, View } from "@react-pdf/renderer";

import { Document, EmptyState, ReportShell, SectionTitle } from "./primitives";
import { PatientReportSections } from "./PatientReport";
import type { BatchReportModel } from "./batchReportModel";
import { FONT, NEUTRAL, SP, STATUS } from "./theme";

const s = StyleSheet.create({
  summaryRow: { flexDirection: "row", marginBottom: SP.md },
  summaryCard: { flex: 1, borderWidth: 1, borderColor: NEUTRAL.hair, borderRadius: 8, backgroundColor: NEUTRAL.surface, padding: SP.lg },
  summaryLabel: { fontSize: 7.5, letterSpacing: 0.7, textTransform: "uppercase", color: NEUTRAL.inkSoft, marginBottom: SP.sm },
  summaryValue: { fontFamily: FONT.display, fontWeight: 700, fontSize: 18, color: NEUTRAL.ink },
  sectionBody: { marginTop: SP.xs },
  failText: { fontSize: 9, color: STATUS.dangerText, marginBottom: 2 },
});

export function BatchReportDoc({ model }: { model: BatchReportModel }) {
  return (
    <Document>
      {/* Capa do lote */}
      <ReportShell
        eyebrow="Relatório em lote"
        patientName={`${model.includedCount} de ${model.total} paciente(s)`}
        subtitle={`Período: ${model.periodLabel}`}
        identity={[
          { label: "Profissional", value: model.exportedByName },
          { label: "Clínica", value: model.clinicName },
          { label: "Período", value: model.periodLabel },
          { label: "Incluídos", value: `${model.includedCount}/${model.total}` },
        ]}
        clinicName={model.clinicName}
        emittedAt={model.generatedAt}
        footerLabel="Relatório em lote"
      >
        <View style={s.summaryRow}>
          <View style={[s.summaryCard, { marginRight: SP.md }]}>
            <Text style={s.summaryLabel}>Pacientes incluídos</Text>
            <Text style={s.summaryValue}>{model.includedCount}</Text>
          </View>
          <View style={s.summaryCard}>
            <Text style={s.summaryLabel}>Não incluídos</Text>
            <Text style={s.summaryValue}>{model.failed.length}</Text>
          </View>
        </View>

        {model.failed.length > 0 ? (
          <View>
            <SectionTitle title="Pacientes não incluídos" hint="autorização negada ou erro" />
            <View style={s.sectionBody}>
              {model.failed.map((f) => (
                <Text key={f.patientId} style={s.failText}>
                  • {f.name ?? "Paciente"} — não incluído neste lote.
                </Text>
              ))}
            </View>
          </View>
        ) : (
          <View>
            <SectionTitle title="Resumo" />
            <View style={s.sectionBody}>
              <EmptyState text="Todos os pacientes selecionados foram incluídos." />
            </View>
          </View>
        )}
      </ReportShell>

      {/* Um bloco (página) por paciente incluído — reusa a casca + o corpo por paciente. */}
      {model.patients.map((p, i) => (
        <ReportShell
          key={i}
          eyebrow="Relatório do paciente"
          patientName={p.patientName}
          subtitle={`Período: ${p.periodLabel}`}
          identity={p.identity}
          clinicName={p.clinicName}
          emittedAt={p.emittedAt}
          footerLabel="Relatório em lote"
        >
          <PatientReportSections model={p} />
        </ReportShell>
      ))}
    </Document>
  );
}
