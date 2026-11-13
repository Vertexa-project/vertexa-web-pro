// Tabela de movimentações (kardex) compartilhada por Saídas e Movimentações: tabela no computador, cartões abaixo de 640 px.
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FinTable } from "@/components/fin/FinUi";
import type { MovementRow } from "@/lib/api/stockMoves";
import { formatBRL } from "@/lib/domain/finance";
import { formatQty, formatUnitCost, MOVEMENT_TYPE_LABEL } from "@/lib/domain/stockMoves";
import { brDate, movementDetail } from "@/pages/stock/movementFormat";

export function MovementTable({ rows, label, onReverse }: { rows: MovementRow[]; label: string; onReverse?: (m: MovementRow) => void }) {
  const canReverse = (m: MovementRow) => Boolean(onReverse) && !m.reversed && m.movement_type !== "reversal" && m.movement_type !== "sale";
  return (
    <FinTable
      label={label} rows={rows} rowKey={(m) => m.id}
      columns={[
        { header: "Item", role: "title", cell: (m) => <>{m.item_name}<span className="block text-xs font-normal text-muted-foreground">{m.unit_name} · {brDate(m.occurred_on)}</span></> },
        { header: "Situação", role: "badge", cell: (m) => (
          <span className="flex flex-wrap justify-end gap-1">
            <Badge tone={m.qty > 0 ? "success" : "info"}>{MOVEMENT_TYPE_LABEL[m.movement_type] ?? m.movement_type}</Badge>
            {m.reversed ? <Badge tone="muted">Estornada</Badge> : null}
          </span>
        ) },
        { header: "Quantidade", nowrap: true, cell: (m) => <span className={m.qty < 0 ? "text-destructive" : undefined}>{m.qty > 0 ? "+" : ""}{formatQty(m.qty)} {m.stock_unit}</span> },
        { header: "Custo unitário", nowrap: true, cell: (m) => formatUnitCost(m.unit_cost_cents) },
        { header: "Custo total", nowrap: true, cell: (m) => formatBRL(Math.abs(m.total_cost_cents)) },
        { header: "Saldo depois", nowrap: true, cell: (m) => formatQty(m.balance_after) },
        { header: "Lote", cell: (m) => <>{m.lot_code}{m.expiry_date ? <span className="block text-xs text-muted-foreground">vence {brDate(m.expiry_date)}</span> : null}</> },
        { header: "Detalhes", wide: true, cell: (m) => <span className="text-xs">{movementDetail(m) || "—"}{m.user_name ? <span className="block text-muted-foreground">por {m.user_name}</span> : null}</span> },
        { header: "Ações", role: "action", cell: (m) => (canReverse(m) ? <Button size="sm" variant="outline" onClick={() => onReverse?.(m)} aria-label={`Estornar ${m.item_name}`}>Estornar</Button> : null) },
      ]}
    />
  );
}
