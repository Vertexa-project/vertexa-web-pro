/** PDF dos relatórios de estoque (Entrega 8): tabela simples, Helvetica, sem dado clínico. */
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { ReportColumn, Row } from "@/lib/domain/stockReports";

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8.5, fontFamily: "Helvetica", color: "#111" },
  h1: { fontSize: 14, fontWeight: 700, marginBottom: 2 }, sub: { color: "#555", marginBottom: 8 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ddd", paddingVertical: 3 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#999", paddingVertical: 3, fontWeight: 700 },
  cell: { flexGrow: 1, flexBasis: 0, paddingRight: 4 }, num: { textAlign: "right" }, total: { marginTop: 8, fontWeight: 700 },
});

export function StockReportPdf({ title, subtitle, columns, rows, totals }: { title: string; subtitle: string; columns: ReportColumn[]; rows: Row[]; totals: string[] }) {
  return (
    <Document title={title}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.h1}>{title}</Text>
        <Text style={s.sub}>{subtitle}</Text>
        <View style={s.head} fixed>{columns.map((c) => <Text key={c.header} style={[s.cell, c.right ? s.num : {}]}>{c.header}</Text>)}</View>
        {rows.map((r, i) => <View key={i} style={s.row} wrap={false}>{columns.map((c) => <Text key={c.header} style={[s.cell, c.right ? s.num : {}]}>{c.text(r)}</Text>)}</View>)}
        {totals.map((t) => <Text key={t} style={s.total}>{t}</Text>)}
      </Page>
    </Document>
  );
}
