// Colunas dos relatórios de estoque (Entrega 8): uma definição só alimenta a tela, o CSV/Excel e o PDF (a soma da lista = o total mostrado).
import type { ReportKey } from "@/lib/api/stockE8";
import { brDate, ITEM_TYPE_LABEL, moneyOrZero } from "@/lib/domain/stockE8";
import { formatQty } from "@/lib/domain/stockMoves";
import type { ExportColumn } from "@/lib/domain/tableExport";

export type Row = Record<string, unknown>;
export interface ReportColumn { header: string; kind: "text" | "money" | "qty"; /** número bruto para exportar (centavos / quantidade) ou texto */ raw: (r: Row) => string | number | null; /** texto da tela e do PDF */ text: (r: Row) => string; right?: boolean }

const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (header: string, f: (r: Row) => string): ReportColumn => ({ header, kind: "text", raw: f, text: f });
const date = (header: string, key: string): ReportColumn => ({ header, kind: "text", raw: (r) => (r[key] ? brDate(s(r[key])) : ""), text: (r) => (r[key] ? brDate(s(r[key])) : "—") });
const qty = (header: string, key: string, unitKey = "stock_unit"): ReportColumn => ({ header, kind: "qty", raw: (r) => num(r[key]), text: (r) => (r[key] === null || r[key] === undefined ? "—" : `${formatQty(Number(r[key]))}${r[unitKey] ? ` ${s(r[unitKey])}` : ""}`), right: true });
const cents = (header: string, key: string): ReportColumn => ({ header, kind: "money", raw: (r) => num(r[key]), text: (r) => (r[key] === null || r[key] === undefined ? "—" : moneyOrZero(Number(r[key]))), right: true });
const count = (header: string, key = "count"): ReportColumn => ({ header, kind: "qty", raw: (r) => num(r[key]), text: (r) => s(r[key]), right: true });

const LOSS_KIND: Record<string, string> = { loss: "Perda", breakage: "Quebra / avaria", expiry: "Vencimento", transfer_diff: "Diferença de transferência" };

export const REPORT_COLUMNS: Record<ReportKey, ReportColumn[]> = {
  position: [txt("Item", (r) => s(r.item_name)), txt("Categoria", (r) => s(r.category)), txt("Tipo", (r) => ITEM_TYPE_LABEL[s(r.item_type)] ?? s(r.item_type)), txt("Unidade", (r) => s(r.unit_name)), qty("Saldo", "qty"), cents("Custo médio", "avg_cost_cents"), cents("Valor", "value_cents")],
  movements: [txt("Item", (r) => s(r.item_name)), txt("Unidade", (r) => s(r.unit_name)), count("Movimentos"), qty("Entradas", "in_qty"), cents("Valor das entradas", "in_cents"), qty("Saídas", "out_qty"), cents("Valor das saídas", "out_cents"), cents("Saldo do período", "value_cents")],
  consumption: [txt("Serviço", (r) => s(r.service) || "—"), txt("Profissional", (r) => s(r.professional) || "—"), txt("Item", (r) => s(r.item_name) || "—"), count("Baixas"), qty("Quantidade", "qty"), cents("Custo", "value_cents")],
  losses: [txt("Motivo", (r) => LOSS_KIND[s(r.kind)] ?? s(r.kind)), txt("Item", (r) => s(r.item_name)), txt("Unidade", (r) => s(r.unit_name)), count("Ocorrências"), qty("Quantidade", "qty"), cents("Valor", "value_cents"), txt("Observações", (r) => s(r.reasons))],
  validity: [txt("Item", (r) => s(r.item_name)), txt("Unidade", (r) => s(r.unit_name)), txt("Lote", (r) => s(r.lot_code)), date("Validade", "expiry_date"),
    { header: "Situação", kind: "text", raw: (r) => (Number(r.days_left) < 0 ? `Vencido há ${-Number(r.days_left)} dias` : `Vence em ${r.days_left} dias`), text: (r) => (Number(r.days_left) < 0 ? `Vencido há ${-Number(r.days_left)} dias` : Number(r.days_left) === 0 ? "Vence hoje" : `Vence em ${r.days_left} dias`) }, qty("Saldo", "qty"), cents("Valor", "value_cents")],
  idle: [txt("Item", (r) => s(r.item_name)), txt("Categoria", (r) => s(r.category)), txt("Unidade", (r) => s(r.unit_name)), qty("Saldo", "qty"), date("Última saída", "last_out"), date("Primeira entrada", "first_in"), count("Dias sem giro", "days_idle"), cents("Valor parado", "value_cents")],
  purchases: [txt("Fornecedor", (r) => s(r.supplier_name)), txt("CNPJ/CPF", (r) => s(r.tax_id)), count("Entradas", "entries"), cents("Itens", "items_total_cents"), cents("Frete", "freight_cents"), cents("Total", "value_cents")],
};

/** Totais mostrados: a soma da LISTA CARREGADA tem de bater com o total do servidor (conferência da tela). */
export const REPORT_TOTAL_KEYS: Record<ReportKey, { key: string; label: string; kind: "money" | "count" }[]> = {
  position: [{ key: "value_cents", label: "Valor total em estoque", kind: "money" }],
  movements: [{ key: "count", label: "Movimentos", kind: "count" }, { key: "in_cents", label: "Entradas", kind: "money" }, { key: "out_cents", label: "Saídas", kind: "money" }, { key: "value_cents", label: "Saldo do período", kind: "money" }],
  consumption: [{ key: "count", label: "Baixas", kind: "count" }, { key: "value_cents", label: "Custo do consumo", kind: "money" }],
  losses: [{ key: "count", label: "Ocorrências", kind: "count" }, { key: "value_cents", label: "Perdas", kind: "money" }],
  validity: [{ key: "value_cents", label: "Valor em risco", kind: "money" }],
  idle: [{ key: "value_cents", label: "Valor parado", kind: "money" }],
  purchases: [{ key: "entries", label: "Entradas", kind: "count" }, { key: "items_total_cents", label: "Itens", kind: "money" }, { key: "freight_cents", label: "Frete", kind: "money" }, { key: "value_cents", label: "Total comprado", kind: "money" }],
};

export function exportColumns(report: ReportKey): ExportColumn<Row>[] {
  return REPORT_COLUMNS[report].map((c) => ({ header: c.header, value: c.raw, kind: c.kind }));
}
export function totalText(kind: "money" | "count", v: number): string {
  return kind === "money" ? moneyOrZero(v) : String(v);
}
/** A soma de cada coluna de total, calculada sobre as linhas da tela, tem de igualar o total do servidor (quando a lista não foi truncada). */
export function totalsMatch(report: ReportKey, rows: Row[], totals: Record<string, number>): boolean {
  return REPORT_TOTAL_KEYS[report].every((t) => Math.round(rows.reduce((a, r) => a + Number(r[t.key] ?? 0), 0)) === Math.round(totals[t.key] ?? 0));
}
