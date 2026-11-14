// Estoque › Saldo (Entrega 3): item × unidade com lotes, validade, custo médio e valor total; filtros e exportação CSV/Excel.
import { useMemo, useState } from "react";
import { Boxes } from "lucide-react";

import { CheckField, ExportButtons, Field, FinTable, NativeSelect } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useFinContext, useUnits } from "@/hooks/useFin";
import { useBalances } from "@/hooks/useStockMoves";
import type { BalanceRow } from "@/lib/api/stockMoves";
import { canSeeStockMoves } from "@/lib/domain/finAccess";
import { formatBRL } from "@/lib/domain/finance";
import { EXPIRY_STATUS_LABEL, expiryStatus, formatQty, formatUnitCost, todayIsoBR, type ExpiryStatus } from "@/lib/domain/stockMoves";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";
import { StockShell } from "@/pages/stock/StockShell";

const br = (iso: string | null) =>
  !iso ? "—" : iso.length > 10 ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : iso.split("-").reverse().join("/");
const expiryTone = (s: ExpiryStatus) => (s === "expired" ? "destructive" : s === "d30" ? "destructive" : s === "d60" ? "warning" : s === "d90" ? "info" : "muted");

export function ExpiryBadge({ expiry, today }: { expiry: string | null; today: string }) {
  const s = expiryStatus(expiry, today);
  if (s === "none" || s === "ok") return null;
  return <Badge tone={expiryTone(s)}>{EXPIRY_STATUS_LABEL[s]}</Badge>;
}

export function StockBalanceTab() {
  const { clinicId, access, isLoading } = useFinContext();
  const canRead = canSeeStockMoves(access);
  const units = (useUnits(clinicId, canRead).data ?? []).filter((u) => u.is_active);
  const [unitId, setUnitId] = useState("");
  const [search, setSearch] = useState("");
  const [onlyPositive, setOnlyPositive] = useState(true);
  const q = useBalances(clinicId, { unitId: unitId || null, search, onlyPositive }, canRead);
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const today = todayIsoBR();
  const total = useMemo(() => rows.reduce((a, r) => a + r.value_cents, 0), [rows]);
  const lotsText = (r: BalanceRow) => r.lots.map((l) => `${l.lot_code} (${br(l.expiry_date)}): ${formatQty(l.qty)}`).join(" | ");

  const columns: ExportColumn<BalanceRow>[] = [
    { header: "Item", value: (r) => r.item_name },
    { header: "Categoria", value: (r) => r.category },
    { header: "Unidade da clínica", value: (r) => r.unit_name },
    { header: "Unidade de estoque", value: (r) => r.stock_unit },
    { header: "Saldo", value: (r) => r.qty_on_hand, kind: "qty" },
    { header: "Estoque mínimo", value: (r) => r.min_qty, kind: "qty" },
    { header: "Custo médio (R$)", value: (r) => r.avg_cost_cents / 100, kind: "qty" },
    { header: "Valor total (R$)", value: (r) => r.value_cents, kind: "money" },
    { header: "Próxima validade", value: (r) => br(r.next_expiry) },
    { header: "Vencido (qtde)", value: (r) => r.expired_qty, kind: "qty" },
    { header: "Lotes", value: lotsText },
  ];

  return (
    <StockShell description="Saldo por item e unidade da clínica, com lotes, validade, custo médio e valor. O saldo é sempre a soma das movimentações.">
      {isLoading || (q.isLoading && canRead) ? <LoadingState /> : !canRead ? <NoAccess text="O saldo do estoque é do administrador, do gestor, do estoquista e do financeiro (consulta)." /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <div className="min-w-0 space-y-4">
          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto]">
            <Field label="Buscar" htmlFor="bal-search"><Input id="bal-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou categoria do item" /></Field>
            <Field label="Unidade" htmlFor="bal-unit">
              <NativeSelect id="bal-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="">Todas</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </NativeSelect>
            </Field>
            <div className="flex items-end pb-2"><CheckField id="bal-positive" label="Só com saldo" checked={onlyPositive} onChange={setOnlyPositive} /></div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ExportButtons columns={columns} rows={rows} filename="saldo-de-estoque" sheetName="Saldo" />
            <p className="text-sm">Valor em estoque: <strong className="tabular-nums">{formatBRL(total)}</strong></p>
          </div>
          {rows.length === 0 ? (
            <EmptyState icon={Boxes} title="Nenhum saldo lançado" description="Lance o saldo inicial ou uma entrada na aba Entradas para o item aparecer aqui." />
          ) : (
            <FinTable
              label="Saldo por item e unidade" rows={rows} rowKey={(r) => `${r.item_id}-${r.unit_id}`}
              columns={[
                { header: "Item", role: "title", cell: (r) => (
                  <>
                    {r.item_name}
                    <span className="block text-xs font-normal text-muted-foreground">{r.category} · {r.unit_name}</span>
                    {r.below_min || r.expired_qty > 0 || expiryStatus(r.next_expiry, today) !== "ok" ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {r.below_min ? <Badge tone="warning">Abaixo do mínimo</Badge> : null}
                        {r.expired_qty > 0 ? <Badge tone="destructive">Tem lote vencido</Badge> : <ExpiryBadge expiry={r.next_expiry} today={today} />}
                      </span>
                    ) : null}
                  </>
                ) },
                { header: "Saldo", nowrap: true, cell: (r) => <>{formatQty(r.qty_on_hand)} {r.stock_unit}{r.open_qty > 0 ? <span className="block text-xs text-muted-foreground">{formatQty(r.open_qty)} em unidade aberta</span> : null}</> },
                { header: "Custo médio", nowrap: true, cell: (r) => formatUnitCost(r.avg_cost_cents) },
                { header: "Valor total", nowrap: true, cell: (r) => formatBRL(r.value_cents) },
                { header: "Próxima validade", nowrap: true, cell: (r) => br(r.next_expiry) },
                { header: "Mínimo", nowrap: true, cell: (r) => (r.min_qty === null ? "—" : formatQty(r.min_qty)) },
                { header: "Lotes", wide: true, cell: (r) => (
                  <ul className="space-y-0.5 text-xs">
                    {r.lots.map((l) => (
                      <li key={l.lot_id} className="flex flex-wrap items-center gap-x-2">
                        <span className="font-medium">{l.lot_code}</span>
                        <span className="text-muted-foreground">vence {br(l.expiry_date)}</span>
                        <span className="tabular-nums">{formatQty(l.qty)}</span>
                        {l.expired ? <Badge tone="destructive">Vencido</Badge> : null}
                      </li>
                    ))}
                  </ul>
                ) },
              ]}
            />
          )}
        </div>
      )}
    </StockShell>
  );
}
