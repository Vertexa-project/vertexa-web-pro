// Painel financeiro (Entrega 7): tipos, rótulos, formatação sem «-0,00», agenda, evolução e colunas de exportação.
// As definições dos números (Vendido, Recebido, A receber, Em atraso, Margem…) são do servidor (RPCs fin_dashboard_*); aqui só se descreve o que mostrar.
import type { ClosingStatus } from "@/lib/domain/finClosing";
import { CLOSING_STATUS_LABEL, brDate } from "@/lib/domain/finClosing";
import type { FinAccess } from "@/lib/domain/finAccess";
import { formatBRL } from "@/lib/domain/finance";
import { periodName } from "@/lib/domain/taxRate";
import type { ExportColumn } from "@/lib/domain/tableExport";

export interface DashCards {
  sold_cents: number; sold_count: number; ticket_cents: number | null; received_cents: number; fees_cents: number; tax_cents: number; material_cents: number;
  repasse_cents: number; products_cost_cents: number; margin_cents: number; products_revenue_cents: number; products_commission_cents: number; products_margin_cents: number;
  to_receive_cents: number; to_receive_count: number; overdue_cents: number; overdue_count: number; overdue_titles_cents: number; overdue_titles_count: number;
  overdue_sales_cents: number; overdue_sales_count: number;
}
export interface DashEvolution { period: string; sold_cents: number; received_cents: number; margin_cents: number }
export interface DashMethod { key: string; label: string; cents: number; count: number }
export interface DashProfessional {
  professional_id: string; name: string; appointments: number; revenue_cents: number; material_cents: number; repasse_cents: number; repasse_source: "closing" | "lines" | null;
  closing_pro_id: string | null; pct_repassed: number | null; margin_cents: number;
}
export interface DashService { service_id: string; name: string; quantity: number; revenue_cents: number; material_cents: number; avg_material_cents: number; unit_margin_cents: number }
export interface DashAgendaBucket { from: string; to: string | null; cents: number; count: number }
export type PendencyKey = "appt_no_sale" | "unruled" | "overdue_titles" | "packages" | "cash" | "stock";
export interface DashSummary {
  period: string; unit_id: string | null; today: string; overdue_days: number; all_units: boolean; closing_status: ClosingStatus | null;
  cards: DashCards; evolution: DashEvolution[]; by_method: DashMethod[]; by_professional: DashProfessional[]; by_service: DashService[]; agenda: DashAgendaBucket[];
  pendencies: Record<PendencyKey, { count: number; cents: number }>;
}

export type DashMetric =
  | "sold" | "ticket" | "received" | "fees" | "to_receive" | "overdue" | "overdue_titles" | "repasse" | "pro_lines" | "material" | "tax" | "products_revenue" | "products_cost"
  | "products_commission" | "margin" | "pro_appointments" | "pro_margin" | "service_appointments" | "appt_no_sale" | "unruled" | "packages" | "cash" | "stock";
export interface DashParams { professional?: string; service?: string; method?: string; from?: string; to?: string | null }
/** O que o clique abriu: a métrica, o mês e a unidade do painel e o recorte (profissional, serviço, forma de pagamento, faixa da agenda). */
export interface DashTarget { metric: DashMetric; period: string; unitId: string | null; params?: DashParams; title: string }
export type DashRow = Record<string, unknown> & { id: string; value_cents: number };
export interface DashDetail { metric: DashMetric; period: string; count: number; total_cents: number; offset: number; limit: number; truncated: boolean; rows: DashRow[] }

// ---------- formatação ----------
/** Dinheiro sem «-0,00»: zero (ou -0) sempre aparece como R$ 0,00. */
export const moneyText = (cents: number | null | undefined): string => formatBRL(cents ? cents : 0);
/** Valor de ajuste mostrado com sinal explícito (+/−), para composições. */
export const signedMoneyText = (cents: number): string => (cents > 0 ? `+ ${moneyText(cents)}` : cents < 0 ? `− ${moneyText(-cents)}` : moneyText(0));
export const pctText = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`);
export const countText = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
export const dateTimeBR = (iso: unknown): string =>
  typeof iso === "string" && iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
export const dateBR = (iso: unknown): string => (typeof iso === "string" && iso ? brDate(iso) : "—");
export const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

// ---------- mês ----------
/** Mês atual de Brasília (AAAA-MM) a partir de «hoje» (AAAA-MM-DD). */
export const currentPeriod = (todayIso: string): string => todayIso.slice(0, 7);
export const periodLabel = (period: string): string => periodName(period);
export const periodShort = (period: string): string => `${periodName(period).slice(0, 3)}/${period.slice(2, 4)}`;

// ---------- agenda ----------
export function agendaLabel(b: Pick<DashAgendaBucket, "from" | "to">): string {
  const dm = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
  return b.to ? (b.from === b.to ? dm(b.from) : `${dm(b.from)} a ${dm(b.to)}`) : "Depois de 90 dias";
}

// ---------- gráfico de evolução ----------
export interface ChartLine { key: "sold" | "received" | "margin"; label: string; points: string; color: string }
/** Pontos (x,y em unidades do viewBox) das três linhas; o eixo vai do menor ao maior valor de qualquer série (margem pode ser negativa). */
export function evolutionLines(evo: DashEvolution[], width = 300, height = 100, pad = 6): ChartLine[] {
  const series: { key: ChartLine["key"]; label: string; color: string; get: (e: DashEvolution) => number }[] = [
    { key: "sold", label: "Vendido", color: "hsl(24 95% 53%)", get: (e) => e.sold_cents },
    { key: "received", label: "Recebido", color: "hsl(142 60% 35%)", get: (e) => e.received_cents },
    { key: "margin", label: "Margem", color: "hsl(215 70% 45%)", get: (e) => e.margin_cents },
  ];
  const all = evo.flatMap((e) => series.map((s) => s.get(e)));
  const lo = Math.min(0, ...all); const hi = Math.max(1, ...all);
  const x = (i: number) => pad + (evo.length <= 1 ? 0 : (i * (width - 2 * pad)) / (evo.length - 1));
  const y = (v: number) => height - pad - ((v - lo) * (height - 2 * pad)) / (hi - lo || 1);
  return series.map((s) => ({ key: s.key, label: s.label, color: s.color, points: evo.map((e, i) => `${x(i).toFixed(1)},${y(s.get(e)).toFixed(1)}`).join(" ") }));
}

// ---------- acesso ----------
/** Unidades que o papel alcança no painel (Admin: todas; Gestor/Financeiro: as dos seus papéis). O servidor confere de novo. */
export function dashUnits<U extends { id: string }>(access: FinAccess, units: U[]): U[] {
  if (access.isAdmin) return units;
  const roles = access.roles.filter((r) => r.role === "gestor" || r.role === "financeiro");
  if (roles.some((r) => r.allUnits)) return units;
  const ids = new Set(roles.flatMap((r) => r.unitIds));
  return units.filter((u) => ids.has(u.id));
}

// ---------- rótulos ----------
export const REPASSE_NOTE = "Com o fechamento iniciado: o bruto de cada extrato. Antes: a soma dos lançamentos do mês (fixo mensal, garantia, faixa e taxa de uso entram quando o fechamento é iniciado).";
export const closingNote = (s: ClosingStatus | null, allUnits: boolean): string =>
  !allUnits ? "Lançamentos da unidade" : s ? `Fechamento: ${CLOSING_STATUS_LABEL[s]}` : "Prévia dos lançamentos do mês";

export const METRIC_INFO: Record<DashMetric, { title: string; hint: string }> = {
  sold: { title: "Vendido", hint: "Vendas criadas no mês, líquidas de desconto, sem as canceladas." },
  ticket: { title: "Ticket médio", hint: "Vendido ÷ número de vendas. A lista são as vendas do cálculo." },
  received: { title: "Recebido", hint: "Títulos liquidados no mês (valor bruto)." },
  fees: { title: "Taxas de pagamento", hint: "Bruto menos o líquido liquidado dos títulos liquidados no mês." },
  to_receive: { title: "A receber", hint: "Títulos com liquidação prevista de hoje em diante." },
  overdue: { title: "Em atraso", hint: "Títulos vencidos e não liquidados, mais vendas sem recebimento há mais de 7 dias." },
  overdue_titles: { title: "Títulos em atraso", hint: "Títulos com data prevista vencida e não liquidados." },
  repasse: { title: "Repasses do mês", hint: REPASSE_NOTE },
  pro_lines: { title: "Lançamentos de repasse", hint: "Lançamentos do mês deste profissional." },
  material: { title: "Custo de material", hint: "Custo do material baixado nos atendimentos realizados no mês." },
  tax: { title: "Imposto", hint: "Alíquota do mês de cada unidade × recebido da unidade." },
  products_revenue: { title: "Receita de produtos", hint: "Produtos e manipulados vendidos no mês (vendas não canceladas)." },
  products_cost: { title: "Custo dos produtos vendidos", hint: "Saídas de estoque das vendas, já descontados os estornos e devoluções." },
  products_commission: { title: "Comissões de produtos", hint: "Comissões de venda de produto lançadas no mês." },
  margin: { title: "Margem da clínica", hint: "Recebido − taxas − imposto − material − repasses − custo dos produtos. Clique em cada linha para ver a lista." },
  pro_appointments: { title: "Atendimentos do profissional", hint: "Atendimentos realizados no mês em que participou. A receita gerada conta só os que ele respondeu." },
  pro_margin: { title: "Margem gerada pelo profissional", hint: "Receita gerada − repasse − material dos atendimentos que respondeu." },
  service_appointments: { title: "Atendimentos do serviço", hint: "Atendimentos realizados no mês deste serviço." },
  appt_no_sale: { title: "Atendidos sem venda", hint: "Atendimentos realizados sem venda nem pacote ligados." },
  unruled: { title: "Atendimentos sem regra de repasse", hint: "Participantes de atendimentos realizados (últimos 12 meses) sem regra de repasse vigente. Bloqueia a aprovação do fechamento." },
  packages: { title: "Pacotes vencendo em 30 dias", hint: "Pacotes ativos que vencem em até 30 dias com sessões ainda não realizadas." },
  cash: { title: "Caixas não fechados ou com diferença", hint: "Caixa de dia anterior ainda aberto, fechamento aguardando aprovação e fechamentos dos últimos 30 dias com diferença." },
  stock: { title: "Itens abaixo do mínimo", hint: "Itens cujo saldo da unidade está abaixo do mínimo configurado." },
};

export const PENDENCIES: { key: PendencyKey; label: string; metric: DashMetric; showCents: boolean }[] = [
  { key: "appt_no_sale", label: "Atendidos sem venda", metric: "appt_no_sale", showCents: false },
  { key: "unruled", label: "Atendimentos sem regra de repasse", metric: "unruled", showCents: false },
  { key: "overdue_titles", label: "Títulos em atraso", metric: "overdue_titles", showCents: true },
  { key: "packages", label: "Pacotes vencendo em 30 dias", metric: "packages", showCents: false },
  { key: "cash", label: "Caixas não fechados ou com diferença", metric: "cash", showCents: false },
  { key: "stock", label: "Itens abaixo do mínimo", metric: "stock", showCents: false },
];

export const MOVEMENT_LABEL: Record<string, string> = { sale: "Venda", reversal: "Estorno", patient_return: "Devolução do paciente" };
export const SALE_STATUS_LABEL: Record<string, string> = { open: "Sem recebimento", partial: "Parcial", paid: "Paga", canceled: "Cancelada" };
export const CASH_STATUS_LABEL: Record<string, string> = { open: "Aberto", pending_approval: "Aguardando aprovação", closed: "Fechado" };
export const ROLE_LABEL: Record<string, string> = { responsavel: "Responsável", executor: "Executor", auxiliar: "Auxiliar", vendedor: "Vendedor" };
export const LINE_LABEL: Record<string, string> = { pct: "Percentual", tier_adjust: "Ajuste de faixa", fixed_exec: "Fixo por execução", fixed_monthly: "Fixo mensal", guarantee: "Garantia", commission: "Comissão", usage_fee: "Taxa de uso", adjustment: "Ajuste", withholding: "Retenção" };

export function dashErrorMessage(e: unknown): string {
  const m = (e as { message?: string }).message ?? "";
  const code = (e as { code?: string }).code;
  if (m.includes("INVALID_PERIOD")) return "Escolha um mês válido.";
  if (code === "42501" || m.includes("forbidden")) return "Você não tem permissão para ver este painel.";
  return "Não foi possível carregar agora. Tente novamente.";
}

// ---------- exportação da lista aberta (CSV/Excel) ----------
const txt = (key: string, header: string): ExportColumn<DashRow> => ({ header, value: (r) => str(r[key]) });
const money = (key: string, header: string): ExportColumn<DashRow> => ({ header, value: (r) => num(r[key]), kind: "money" });
const date = (key: string, header: string): ExportColumn<DashRow> => ({ header, value: (r) => (typeof r[key] === "string" ? str(r[key]).slice(0, 10).split("-").reverse().join("/") : ""), });
const valueCol = (header: string): ExportColumn<DashRow> => ({ header, value: (r) => r.value_cents, kind: "money" });

export function detailExportColumns(metric: DashMetric): ExportColumn<DashRow>[] {
  switch (metric) {
    case "sold": case "ticket":
      return [{ header: "Data", value: (r) => dateTimeBR(r.at) }, txt("unit_name", "Unidade"), txt("patient_name", "Paciente"), txt("seller_name", "Vendedor"), { header: "Situação", value: (r) => SALE_STATUS_LABEL[str(r.status)] ?? str(r.status) }, valueCol("Valor líquido")];
    case "received": case "fees":
      return [date("date", "Liquidado em"), txt("unit_name", "Unidade"), txt("patient_name", "Paciente"), txt("method_label", "Forma"), txt("installment", "Parcela"), money("gross_cents", "Bruto"), money("fee_cents", "Taxa"), money("net_cents", "Líquido")];
    case "to_receive": case "overdue": case "overdue_titles":
      return [txt("kind", "Tipo"), date("date", "Data"), txt("unit_name", "Unidade"), txt("patient_name", "Paciente"), txt("method_label", "Forma"), txt("installment", "Parcela"), valueCol("Valor")];
    case "repasse":
      return [txt("name", "Profissional"), { header: "Origem", value: (r) => (r.source === "closing" ? "Fechamento" : "Lançamentos") }, valueCol("Repasse")];
    case "pro_lines":
      return [date("date", "Data"), { header: "Tipo", value: (r) => LINE_LABEL[str(r.line_type)] ?? str(r.line_type) }, txt("service_name", "Serviço"), txt("patient_name", "Paciente"), valueCol("Valor")];
    case "material":
      return [date("date", "Data"), txt("unit_name", "Unidade"), txt("patient_name", "Paciente"), txt("service_name", "Serviço"), valueCol("Custo de material")];
    case "tax":
      return [txt("unit_name", "Unidade"), money("base_cents", "Recebido"), { header: "Alíquota (%)", value: (r) => num(r.rate_pct), kind: "pct" }, valueCol("Imposto")];
    case "products_revenue":
      return [{ header: "Data", value: (r) => dateTimeBR(r.at) }, txt("item_name", "Item"), { header: "Quantidade", value: (r) => num(r.quantity), kind: "qty" }, txt("patient_name", "Paciente"), valueCol("Valor")];
    case "products_cost":
      return [date("date", "Data"), txt("item_name", "Item"), { header: "Movimento", value: (r) => MOVEMENT_LABEL[str(r.movement_type)] ?? str(r.movement_type) }, valueCol("Custo")];
    case "products_commission":
      return [date("date", "Data"), txt("professional_name", "Profissional"), txt("item_name", "Item"), valueCol("Comissão")];
    case "margin": case "pro_margin":
      return [txt("label", "Componente"), txt("sign", "Sinal"), valueCol("Valor")];
    case "pro_appointments": case "service_appointments":
      return [date("date", "Data"), txt("unit_name", "Unidade"), txt("patient_name", "Paciente"), txt("service_name", "Serviço"), money("material_cents", "Material"), valueCol("Receita")];
    case "appt_no_sale":
      return [date("date", "Data"), txt("unit_name", "Unidade"), txt("patient_name", "Paciente"), txt("service_name", "Serviço"), txt("professionals", "Profissionais"), valueCol("Valor do serviço")];
    case "unruled":
      return [date("date", "Data"), txt("unit_name", "Unidade"), txt("service_name", "Serviço"), txt("professional_name", "Profissional"), { header: "Papel", value: (r) => ROLE_LABEL[str(r.role)] ?? str(r.role) }];
    case "packages":
      return [txt("patient_name", "Paciente"), txt("package_name", "Pacote"), date("expires_on", "Vence em"), { header: "Sessões restantes", value: (r) => num(r.remaining), kind: "qty" }, txt("unit_name", "Unidade")];
    case "cash":
      return [date("date", "Dia"), txt("unit_name", "Unidade"), txt("operator_name", "Operador"), { header: "Situação", value: (r) => CASH_STATUS_LABEL[str(r.status)] ?? str(r.status) }, valueCol("Diferença em espécie")];
    case "stock":
      return [txt("item_name", "Item"), txt("unit_name", "Unidade"), { header: "Saldo", value: (r) => num(r.qty_on_hand), kind: "qty" }, { header: "Mínimo", value: (r) => num(r.min_qty), kind: "qty" }];
  }
}

/** Primeiro e último dia do mês (AAAA-MM) para levar o filtro do painel às telas de origem. */
export function monthBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}
/** Endereço com o filtro do painel (mês, unidade e situação) já aplicado. */
export function withFilter(path: string, f: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}
