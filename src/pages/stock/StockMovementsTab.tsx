// Estoque › Movimentações (kardex): histórico de entradas e saídas por item, com filtros, custo, saldo depois, estorno e exportação.
import { useState } from "react";
import { History } from "lucide-react";

import { ExportButtons, Field, NativeSelect } from "@/components/fin/FinUi";
import { FilterBar } from "@/components/fin/FinFilters";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { useFinContext, useStockItems, useUnits } from "@/hooks/useFin";
import { useMovements } from "@/hooks/useStockMoves";
import type { MovementRow } from "@/lib/api/stockMoves";
import { canMoveStock, canSeeStockMoves } from "@/lib/domain/finAccess";
import { MOVEMENT_TYPE_LABEL, type MovementType } from "@/lib/domain/stockMoves";
import { NoAccess } from "@/pages/finance/NoAccess";
import { MovementTable } from "@/pages/stock/MovementTable";
import { movementExportColumns } from "@/pages/stock/movementFormat";
import { PatientReturnDialog, type ReturnTarget } from "@/pages/stock/PatientReturnDialog";
import { ReverseDialog, type ReverseTarget } from "@/pages/stock/ReverseDialog";
import { StockShell } from "@/pages/stock/StockShell";

const TYPES: MovementType[] = ["initial_balance", "purchase", "xml_purchase", "bonus", "sector", "loss", "appointment", "package_delivery", "sale", "patient_return", "reversal"];

export function StockMovementsTab() {
  const { clinicId, access, isLoading } = useFinContext();
  const canRead = canSeeStockMoves(access);
  const canWrite = canMoveStock(access);
  const units = (useUnits(clinicId, canRead).data ?? []).filter((u) => u.is_active);
  const items = useStockItems(clinicId, canRead).data ?? [];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unitId, setUnitId] = useState("");
  const [itemId, setItemId] = useState("");
  const [type, setType] = useState("");
  const [direction, setDirection] = useState<"" | "in" | "out">("");
  const [reversing, setReversing] = useState<ReverseTarget | null>(null);
  const [returning, setReturning] = useState<ReturnTarget | null>(null);
  const q = useMovements(clinicId, { unitId: unitId || null, itemId: itemId || null, type, direction, from, to }, canRead);
  const rows = q.data ?? [];
  const reverse = (m: MovementRow) => setReversing({ kind: "movement", id: m.id, label: `${MOVEMENT_TYPE_LABEL[m.movement_type]} de ${m.item_name}` });

  return (
    <StockShell description="Histórico completo de entradas e saídas, com custo e saldo depois de cada movimento. Nada se apaga: corrige-se por estorno.">
      {isLoading || (q.isLoading && canRead) ? <LoadingState /> : !canRead ? <NoAccess text="As movimentações do estoque são do administrador, do gestor, do estoquista e do financeiro (consulta)." /> : (
        <div className="min-w-0 space-y-4">
          <FilterBar idPrefix="mov" from={from} to={to} onFrom={setFrom} onTo={setTo} units={units} unitId={unitId} onUnit={setUnitId} />
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Item" htmlFor="mov-item">
              <NativeSelect id="mov-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">Todos</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Movimento" htmlFor="mov-type">
              <NativeSelect id="mov-type" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">Todos</option>
                {TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_TYPE_LABEL[t]}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Sentido" htmlFor="mov-dir">
              <NativeSelect id="mov-dir" value={direction} onChange={(e) => setDirection(e.target.value as "" | "in" | "out")}>
                <option value="">Entradas e saídas</option>
                <option value="in">Só entradas</option>
                <option value="out">Só saídas</option>
              </NativeSelect>
            </Field>
          </div>
          <ExportButtons columns={movementExportColumns} rows={rows} filename="movimentacoes-de-estoque" sheetName="Movimentações" />
          {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
            <EmptyState icon={History} title="Nenhuma movimentação" description="Ajuste os filtros, ou lance uma entrada ou saída para começar o histórico." />
          ) : (
            <MovementTable rows={rows} label="Movimentações de estoque" onReverse={canWrite ? reverse : undefined}
              onReturn={canWrite ? (m) => setReturning({ movementId: m.id, itemName: m.item_name, qtyOut: Math.abs(m.qty), stockUnit: m.stock_unit, origin: m.movement_type === "sale" ? "Venda" : "Entrega de pacote" }) : undefined} />
          )}
        </div>
      )}
      <ReverseDialog target={reversing} onClose={() => setReversing(null)} />
      {returning ? <PatientReturnDialog key={returning.movementId} target={returning} onClose={() => setReturning(null)} /> : null}
    </StockShell>
  );
}
