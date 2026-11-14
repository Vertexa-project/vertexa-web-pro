// Colunas de cada lista do painel (F12). Cada linha traz `value_cents` — a parte dela no número do painel; o total da lista é a soma dessa coluna.
import type { ReactNode } from "react";

import type { FinColumn } from "@/components/fin/FinUi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CASH_STATUS_LABEL, LINE_LABEL, MOVEMENT_LABEL, ROLE_LABEL, SALE_STATUS_LABEL, dateBR, dateTimeBR, moneyText, num, str, type DashMetric, type DashRow,
} from "@/lib/domain/finDash";
import { formatQty } from "@/lib/domain/stockMoves";

export interface DashColumnCtx {
  /** abre a lista que compõe a linha (composição da margem, lançamentos do profissional) */
  onDrill: (row: DashRow) => void;
  /** abre o extrato do fechamento */
  onStatement: (closingProId: string) => void;
}

const dash = (v: unknown): ReactNode => (v === null || v === undefined || v === "" ? "—" : String(v));
const money = (header: string, f: (r: DashRow) => number, extra: Partial<FinColumn<DashRow>> = {}): FinColumn<DashRow> => ({ header, cell: (r) => moneyText(f(r)), nowrap: true, className: "text-right", ...extra });
const value = (header: string): FinColumn<DashRow> => money(header, (r) => r.value_cents, { className: "text-right font-medium" });
const date = (header: string, key: string): FinColumn<DashRow> => ({ header, cell: (r) => dateBR(r[key]), nowrap: true });

export function detailColumns(metric: DashMetric, ctx: DashColumnCtx): FinColumn<DashRow>[] {
  switch (metric) {
    case "sold": case "ticket":
      return [
        { header: "Paciente", role: "title", cell: (r) => dash(r.patient_name) },
        { header: "Situação", role: "badge", cell: (r) => <Badge tone={r.status === "paid" ? "success" : r.status === "open" ? "warning" : "muted"}>{SALE_STATUS_LABEL[str(r.status)] ?? str(r.status)}</Badge> },
        { header: "Data", cell: (r) => dateTimeBR(r.at), nowrap: true },
        { header: "Unidade", cell: (r) => dash(r.unit_name) },
        { header: "Vendedor", cell: (r) => dash(r.seller_name) },
        value("Valor líquido"),
      ];
    case "received": case "fees":
      return [
        { header: "Paciente", role: "title", cell: (r) => dash(r.patient_name) },
        date("Liquidado em", "date"),
        { header: "Forma", cell: (r) => <>{dash(r.method_label)} · {dash(r.installment)}</> },
        { header: "Unidade", cell: (r) => dash(r.unit_name) },
        money("Bruto", (r) => num(r.gross_cents), metric === "received" ? { className: "text-right font-medium" } : {}),
        money("Taxa", (r) => num(r.fee_cents), metric === "fees" ? { className: "text-right font-medium" } : {}),
        money("Líquido", (r) => num(r.net_cents)),
      ];
    case "to_receive": case "overdue": case "overdue_titles":
      return [
        { header: "Paciente", role: "title", cell: (r) => dash(r.patient_name) },
        { header: "Tipo", role: "badge", cell: (r) => <Badge tone={r.kind === "venda" ? "warning" : "info"}>{r.kind === "venda" ? "Venda sem recebimento" : "Título"}</Badge> },
        { header: metric === "to_receive" ? "Previsto para" : "Desde", cell: (r) => dateBR(r.date), nowrap: true },
        ...(metric === "to_receive" ? [] : [{ header: "Dias de atraso", cell: (r: DashRow) => dash(r.days_late), className: "text-right", nowrap: true } satisfies FinColumn<DashRow>]),
        { header: "Forma", cell: (r) => <>{dash(r.method_label)}{r.installment ? ` · ${str(r.installment)}` : ""}</> },
        { header: "Unidade", cell: (r) => dash(r.unit_name) },
        value("Valor"),
      ];
    case "repasse":
      return [
        { header: "Profissional", role: "title", cell: (r) => dash(r.name) },
        { header: "Origem", role: "badge", cell: (r) => (r.source === "closing" ? <Badge tone="info">Fechamento</Badge> : <Badge tone="muted">Lançamentos</Badge>) },
        value("Repasse"),
        {
          header: "Ações", role: "action",
          cell: (r) => (r.closing_pro_id
            ? <Button type="button" size="sm" variant="outline" onClick={() => ctx.onStatement(str(r.closing_pro_id))}>Ver extrato</Button>
            : <Button type="button" size="sm" variant="outline" onClick={() => ctx.onDrill(r)}>Ver lançamentos</Button>),
        },
      ];
    case "pro_lines":
      return [
        { header: "Serviço", role: "title", cell: (r) => dash(r.service_name) },
        { header: "Tipo", role: "badge", cell: (r) => <Badge tone="muted">{LINE_LABEL[str(r.line_type)] ?? str(r.line_type)}</Badge> },
        date("Data", "date"),
        { header: "Papel", cell: (r) => (r.role ? ROLE_LABEL[str(r.role)] ?? str(r.role) : "—") },
        { header: "Paciente", cell: (r) => dash(r.patient_name) },
        value("Valor"),
      ];
    case "material":
      return [
        { header: "Serviço", role: "title", cell: (r) => dash(r.service_name) },
        date("Data", "date"),
        { header: "Paciente", cell: (r) => dash(r.patient_name) },
        { header: "Unidade", cell: (r) => dash(r.unit_name) },
        money("Estimado", (r) => num(r.estimated_cents)),
        value("Custo de material"),
      ];
    case "tax":
      return [
        { header: "Unidade", role: "title", cell: (r) => dash(r.unit_name) },
        money("Recebido", (r) => num(r.base_cents)),
        { header: "Alíquota", cell: (r) => `${num(r.rate_pct).toLocaleString("pt-BR")}%`, className: "text-right", nowrap: true },
        value("Imposto"),
      ];
    case "products_revenue":
      return [
        { header: "Item", role: "title", cell: (r) => dash(r.item_name) },
        { header: "Data", cell: (r) => dateTimeBR(r.at), nowrap: true },
        { header: "Quantidade", cell: (r) => formatQty(num(r.quantity)), className: "text-right", nowrap: true },
        { header: "Paciente", cell: (r) => dash(r.patient_name) },
        value("Valor"),
      ];
    case "products_cost":
      return [
        { header: "Item", role: "title", cell: (r) => dash(r.item_name) },
        { header: "Movimento", role: "badge", cell: (r) => <Badge tone={r.movement_type === "sale" ? "muted" : "info"}>{MOVEMENT_LABEL[str(r.movement_type)] ?? str(r.movement_type)}</Badge> },
        date("Data", "date"),
        { header: "Quantidade", cell: (r) => formatQty(num(r.quantity)), className: "text-right", nowrap: true },
        value("Custo"),
      ];
    case "products_commission":
      return [
        { header: "Profissional", role: "title", cell: (r) => dash(r.professional_name) },
        { header: "Item", cell: (r) => dash(r.item_name) },
        date("Data", "date"),
        value("Comissão"),
      ];
    case "margin": case "pro_margin":
      return [
        { header: "Componente", role: "title", cell: (r) => dash(r.label) },
        { header: "Sinal", cell: (r) => dash(r.sign), className: "text-center", nowrap: true },
        value("Valor"),
        { header: "Ações", role: "action", cell: (r) => <Button type="button" size="sm" variant="outline" onClick={() => ctx.onDrill(r)} aria-label={`Ver a lista de ${str(r.label)}`}>Ver lista</Button> },
      ];
    case "pro_appointments": case "service_appointments":
      return [
        { header: "Serviço", role: "title", cell: (r) => dash(r.service_name) },
        ...(metric === "pro_appointments" ? [{ header: "Papel", role: "badge", cell: (r: DashRow) => <Badge tone="muted">{ROLE_LABEL[str(r.role)] ?? str(r.role)}</Badge> } satisfies FinColumn<DashRow>] : []),
        date("Data", "date"),
        { header: "Paciente", cell: (r) => dash(r.patient_name) },
        { header: "Unidade", cell: (r) => dash(r.unit_name) },
        money("Material", (r) => num(r.material_cents)),
        value("Receita"),
      ];
    case "appt_no_sale":
      return [
        { header: "Serviço", role: "title", cell: (r) => dash(r.service_name) },
        date("Data", "date"),
        { header: "Paciente", cell: (r) => dash(r.patient_name) },
        { header: "Profissionais", cell: (r) => dash(r.professionals), wide: true },
        { header: "Unidade", cell: (r) => dash(r.unit_name) },
        value("Valor do serviço"),
      ];
    case "unruled":
      return [
        { header: "Profissional", role: "title", cell: (r) => dash(r.professional_name) },
        { header: "Papel", role: "badge", cell: (r) => <Badge tone="warning">{ROLE_LABEL[str(r.role)] ?? str(r.role)}</Badge> },
        date("Data", "date"),
        { header: "Serviço", cell: (r) => dash(r.service_name) },
        { header: "Unidade", cell: (r) => dash(r.unit_name) },
      ];
    case "packages":
      return [
        { header: "Paciente", role: "title", cell: (r) => dash(r.patient_name) },
        { header: "Pacote", cell: (r) => dash(r.package_name) },
        date("Vence em", "expires_on"),
        { header: "Sessões restantes", cell: (r) => formatQty(num(r.remaining)), className: "text-right", nowrap: true },
        { header: "Unidade", cell: (r) => dash(r.unit_name) },
      ];
    case "cash":
      return [
        { header: "Operador", role: "title", cell: (r) => dash(r.operator_name) },
        { header: "Situação", role: "badge", cell: (r) => <Badge tone={r.status === "closed" ? "muted" : "warning"}>{r.status === "open" ? "Aberto desde o dia" : CASH_STATUS_LABEL[str(r.status)] ?? str(r.status)}</Badge> },
        date("Dia", "date"),
        { header: "Unidade", cell: (r) => dash(r.unit_name) },
        value("Diferença em espécie"),
      ];
    case "stock":
      return [
        { header: "Item", role: "title", cell: (r) => dash(r.item_name) },
        { header: "Unidade", cell: (r) => dash(r.unit_name) },
        { header: "Saldo", cell: (r) => `${formatQty(num(r.qty_on_hand))} ${str(r.stock_unit)}`, className: "text-right", nowrap: true },
        { header: "Mínimo", cell: (r) => `${formatQty(num(r.min_qty))} ${str(r.stock_unit)}`, className: "text-right", nowrap: true },
      ];
  }
}

/** A métrica tem coluna de valor que soma no número (algumas filas só contam linhas). */
export const METRIC_HAS_VALUE: Record<DashMetric, boolean> = {
  sold: true, ticket: true, received: true, fees: true, to_receive: true, overdue: true, overdue_titles: true, repasse: true, pro_lines: true, material: true, tax: true, products_revenue: true,
  products_cost: true, products_commission: true, margin: true, pro_appointments: true, pro_margin: true, service_appointments: true, appt_no_sale: true, unruled: false, packages: false, cash: true, stock: false,
};
