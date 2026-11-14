/** PDF do extrato do profissional e do fechamento do mês (Entrega 6). Fonte padrão do PDF (Helvetica), tabelas simples, sem dado clínico. */
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { ACCEPTANCE_LABEL, negCents, NF_LABEL, STATEMENT_STATUS_LABEL, brDate, paymentText, periodLabel, withholdingName, type ClosingRow, type StatementItem } from "@/lib/domain/finClosing";
import { formatBRL } from "@/lib/domain/finance";
import type { ClosingTotals, StatementView } from "@/lib/api/finClosing";

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  h1: { fontSize: 15, fontWeight: 700, marginBottom: 2 }, sub: { color: "#555", marginBottom: 10 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ddd", paddingVertical: 3 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#999", paddingVertical: 3, fontWeight: 700 },
  cell: { flexGrow: 1, flexBasis: 0, paddingRight: 4 }, num: { textAlign: "right" },
  box: { marginTop: 10, padding: 6, borderWidth: 0.5, borderColor: "#bbb" }, bold: { fontWeight: 700 }, foot: { marginTop: 8, color: "#666", fontSize: 8 },
});
const Cell = ({ children, w = 1, right }: { children: React.ReactNode; w?: number; right?: boolean }) => <Text style={[s.cell, right ? s.num : {}, { flexGrow: w }]}>{children}</Text>;

export function ClosingPdf({ period, rows, totals }: { period: string; rows: ClosingRow[]; totals: ClosingTotals }) {
  return (
    <Document title={`Fechamento ${period}`}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.h1}>Fechamento do repasse · {periodLabel(period)}</Text>
        <Text style={s.sub}>{rows.length} profissional(is)</Text>
        <View style={s.head} fixed><Cell w={2.4}>Profissional</Cell><Cell right>Percentual</Cell><Cell right>Fixos</Cell><Cell right>Garantia/Comissões</Cell><Cell right>Taxa de uso/Ajustes</Cell><Cell right>Total bruto</Cell><Cell right>Retenções</Cell><Cell right>Líquido</Cell><Cell w={1.6}>Aceite</Cell><Cell w={1.2}>NF</Cell><Cell w={1.6}>Pagamento</Cell></View>
        {rows.map((r) => (
          <View key={r.id} style={s.row} wrap={false}>
            <Cell w={2.4}>{r.name}</Cell><Cell right>{formatBRL(r.pct_cents)}</Cell><Cell right>{formatBRL(r.fixed_exec_cents + r.fixed_monthly_cents)}</Cell><Cell right>{formatBRL(r.guarantee_cents + r.commission_cents)}</Cell>
            <Cell right>{formatBRL(r.usage_fee_cents + r.adjustment_cents)}</Cell><Cell right>{formatBRL(r.gross_cents)}</Cell><Cell right>{formatBRL(negCents(r.withholding_cents))}</Cell><Cell right>{formatBRL(r.net_cents)}</Cell>
            <Cell w={1.6}>{ACCEPTANCE_LABEL[r.acceptance]}</Cell><Cell w={1.2}>{NF_LABEL[r.nf_status]}</Cell><Cell w={1.6}>{paymentText(r)}</Cell>
          </View>
        ))}
        <View style={[s.row, s.bold]}><Cell w={2.4}>Total geral</Cell><Cell right>{formatBRL(totals.pct_cents)}</Cell><Cell right>{formatBRL(totals.fixed_exec_cents + totals.fixed_monthly_cents)}</Cell><Cell right>{formatBRL(totals.guarantee_cents + totals.commission_cents)}</Cell>
          <Cell right>{formatBRL(totals.usage_fee_cents + totals.adjustment_cents)}</Cell><Cell right>{formatBRL(totals.gross_cents)}</Cell><Cell right>{formatBRL(negCents(totals.withholding_cents))}</Cell><Cell right>{formatBRL(totals.net_cents)}</Cell><Cell w={4.4}>{" "}</Cell></View>
      </Page>
    </Document>
  );
}

export function StatementPdf({ v, items }: { v: StatementView; items: StatementItem[] }) {
  const r = v.row;
  return (
    <Document title={`Extrato ${v.professional.name} ${v.closing.period}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Extrato de repasse · {periodLabel(v.closing.period)}</Text>
        <Text style={s.sub}>{v.professional.name} · {STATEMENT_STATUS_LABEL[r.status]} · aceite: {ACCEPTANCE_LABEL[r.acceptance]}</Text>
        <View style={s.head} fixed><Cell>Data</Cell><Cell w={1.6}>Paciente</Cell><Cell w={3}>Serviço / papel</Cell><Cell w={1.6}>Tipo</Cell><Cell right>Liquidado</Cell><Cell right>Base</Cell><Cell right>Regra</Cell><Cell right>Repasse</Cell></View>
        {items.map((i, n) => (
          <View key={n} style={s.row} wrap={false}>
            <Cell>{brDate(i.date)}</Cell><Cell w={1.6}>{i.patient ?? ""}</Cell><Cell w={3}>{[i.service, i.role].filter(Boolean).join(" · ")}</Cell><Cell w={1.6}>{i.type}</Cell>
            <Cell right>{i.gross === null ? "" : formatBRL(i.gross)}</Cell><Cell right>{i.base === null ? "" : formatBRL(i.base)}</Cell><Cell right>{i.pct === null ? "" : `${String(i.pct).replace(".", ",")}%`}</Cell><Cell right>{formatBRL(i.amount)}</Cell>
          </View>
        ))}
        <View style={s.box} wrap={false}>
          <View style={s.row}><Cell w={3}>Total bruto</Cell><Cell right>{formatBRL(r.gross_cents)}</Cell></View>
          {v.withholdings.map((w) => <View key={`${w.rule_type}-${w.label ?? ""}`} style={s.row}><Cell w={3}>Retenção {withholdingName(w)} ({String(w.rate_pct).replace(".", ",")}%)</Cell><Cell right>{w.waived ? "dispensada" : formatBRL(negCents(w.amount_cents))}</Cell></View>)}
          <View style={[s.row, s.bold]}><Cell w={3}>Líquido a pagar</Cell><Cell right>{formatBRL(r.net_cents)}</Cell></View>
        </View>
        <Text style={s.foot}>Pagamento: {paymentText(r)}{r.requires_invoice ? ` · NF: ${NF_LABEL[r.nf_status]}${r.invoice_number ? ` nº ${r.invoice_number}` : ""}` : ""}</Text>
      </Page>
    </Document>
  );
}
