// Formatação e colunas de exportação das movimentações de estoque (compartilhadas por Saídas, Movimentações e Entradas).
import type { MovementRow } from "@/lib/api/stockMoves";
import { LOSS_KIND_LABEL, MOVEMENT_TYPE_LABEL } from "@/lib/domain/stockMoves";
import type { ExportColumn } from "@/lib/domain/tableExport";

export const brDate = (iso: string | null) =>
  !iso ? "—" : iso.length > 10 ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : iso.split("-").reverse().join("/");

export function movementDetail(m: MovementRow): string {
  return [m.loss_kind ? LOSS_KIND_LABEL[m.loss_kind] : null, m.purpose, m.patient_name ? `Paciente: ${m.patient_name}` : null, m.supplier_name, m.invoice_number ? `NF ${m.invoice_number}` : null, m.reason]
    .filter(Boolean).join(" · ");
}

export const movementExportColumns: ExportColumn<MovementRow>[] = [
  { header: "Data", value: (m) => brDate(m.occurred_on) },
  { header: "Unidade", value: (m) => m.unit_name },
  { header: "Item", value: (m) => m.item_name },
  { header: "Movimento", value: (m) => MOVEMENT_TYPE_LABEL[m.movement_type] ?? m.movement_type },
  { header: "Quantidade", value: (m) => m.qty, kind: "qty" },
  { header: "Unidade de estoque", value: (m) => m.stock_unit },
  { header: "Custo unitário (R$)", value: (m) => Math.round(Number(m.unit_cost_cents) * 100) / 10000, kind: "qty" },
  { header: "Custo total (R$)", value: (m) => m.total_cost_cents, kind: "money" },
  { header: "Saldo depois", value: (m) => m.balance_after, kind: "qty" },
  { header: "Custo médio depois (R$)", value: (m) => Math.round(Number(m.avg_cost_after_cents) * 100) / 10000, kind: "qty" },
  { header: "Lote", value: (m) => m.lot_code },
  { header: "Validade do lote", value: (m) => brDate(m.expiry_date) },
  { header: "Detalhes", value: movementDetail },
  { header: "Feito por", value: (m) => m.user_name },
  { header: "Estornada", value: (m) => m.reversed },
];

