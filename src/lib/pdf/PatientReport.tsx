// Documento @react-pdf do Relatório do Paciente (WP-REPORT A). Consome o MODELO derivado do JSON
// da RPC (patientReportModel). Reusa a casca (ReportShell) e os primitivos. A4: exibe um AVISO
// legível quando o relatório foi truncado por limite de volume.
import { StyleSheet, Text, View } from "@react-pdf/renderer";

import {
  DataTable,
  Document,
  EmptyState,
  KpiRow,
  PhotoPair,
  ReportShell,
  SectionTitle,
  type PhotoSlot,
} from "./primitives";
import type { PatientReportModel } from "./patientReportModel";
import { BRAND, NEUTRAL, RADIUS, SP } from "./theme";

const s = StyleSheet.create({
  notice: {
    borderWidth: 1,
    borderColor: BRAND.orange,
    backgroundColor: BRAND.orangeTint,
    borderRadius: RADIUS.md,
    paddingVertical: SP.md,
    paddingHorizontal: SP.lg,
    marginBottom: SP.md,
  },
  noticeTitle: { fontSize: 9, fontWeight: 700, color: BRAND.orangeDeep, marginBottom: 2 },
  noticeText: { fontSize: 8.5, color: NEUTRAL.inkSoft },
  sectionBody: { marginTop: SP.xs },
  tableAfterKpis: { marginTop: SP.md },
});

export interface PatientReportPhotos {
  before: PhotoSlot;
  after: PhotoSlot;
}

/** Corpo do relatório de UM paciente (aviso de truncamento + seções + fotos). Reutilizado pelo
 *  relatório individual e por CADA paciente do relatório de LOTE (dentro do próprio ReportShell). */
export function PatientReportSections({
  model,
  photos,
}: {
  model: PatientReportModel;
  photos?: PatientReportPhotos | null;
}) {
  return (
    <>
      {/* A4 — aviso de truncamento (omissão de registros) — POR PACIENTE. */}
      {model.truncated && model.truncationNotice ? (
        <View style={s.notice}>
          <Text style={s.noticeTitle}>Atenção: relatório parcial</Text>
          <Text style={s.noticeText}>{model.truncationNotice}</Text>
        </View>
      ) : null}

      {model.sections.map((sec) => (
        <View key={sec.key} wrap={false}>
          <SectionTitle title={sec.title} />
          <View style={s.sectionBody}>
            {sec.kpis ? <KpiRow items={sec.kpis.map((k) => ({ label: k.label, value: k.value, sub: k.sub }))} /> : null}
            {sec.table ? (
              <View style={sec.kpis ? s.tableAfterKpis : undefined}>
                <DataTable columns={sec.table.columns} rows={sec.table.rows} />
              </View>
            ) : null}
            {!sec.kpis && !sec.table ? <EmptyState text={sec.emptyText ?? "Sem dados."} /> : null}
          </View>
        </View>
      ))}

      {photos ? (
        <View wrap={false}>
          <SectionTitle title="Fotos comparativas" />
          <View style={s.sectionBody}>
            <PhotoPair before={photos.before} after={photos.after} />
          </View>
        </View>
      ) : null}
    </>
  );
}

export function PatientReportDoc({
  model,
  photos,
}: {
  model: PatientReportModel;
  photos: PatientReportPhotos | null;
}) {
  return (
    <Document>
      <ReportShell
        eyebrow="Relatório do paciente"
        patientName={model.patientName}
        subtitle={`Período: ${model.periodLabel}`}
        identity={model.identity}
        clinicName={model.clinicName}
        emittedAt={model.emittedAt}
        footerLabel="Relatório do paciente"
      >
        <PatientReportSections model={model} photos={photos} />
      </ReportShell>
    </Document>
  );
}
