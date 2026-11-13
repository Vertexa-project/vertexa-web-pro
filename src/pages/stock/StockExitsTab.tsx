// Estoque › Saídas: consumo interno, perda/quebra/vencimento e uso por paciente (inclui as baixas de venda). Lista com filtros e nova saída.
import { useState } from "react";
import { MinusCircle, Plus } from "lucide-react";

import { ExportButtons, Field, NativeSelect } from "@/components/fin/FinUi";
import { FilterBar } from "@/components/fin/FinFilters";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFinContext, useUnits } from "@/hooks/useFin";
import { useMovements } from "@/hooks/useStockMoves";
import type { MovementRow } from "@/lib/api/stockMoves";
import { canMoveStock, canSeeStockMoves } from "@/lib/domain/finAccess";
import { MOVEMENT_TYPE_LABEL, type MovementType } from "@/lib/domain/stockMoves";
import { NoAccess } from "@/pages/finance/NoAccess";
import { ExitDialog } from "@/pages/stock/ExitDialog";
import { MovementTable } from "@/pages/stock/MovementTable";
import { movementExportColumns } from "@/pages/stock/movementFormat";
import { ReverseDialog, type ReverseTarget } from "@/pages/stock/ReverseDialog";
import { StockShell } from "@/pages/stock/StockShell";

const OUT_TYPES: MovementType[] = ["sector", "loss", "appointment", "sale"];

export function StockExitsTab() {
  const { clinicId, access, isLoading } = useFinContext();
  const canRead = canSeeStockMoves(access);
  const canWrite = canMoveStock(access);
  const units = (useUnits(clinicId, canRead).data ?? []).filter((u) => u.is_active);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unitId, setUnitId] = useState("");
  const [type, setType] = useState("");
  const [creating, setCreating] = useState(false);
  const [reversing, setReversing] = useState<ReverseTarget | null>(null);
  const q = useMovements(clinicId, { unitId: unitId || null, type, direction: "out", from, to }, canRead);
  const rows = q.data ?? [];
  const reverse = (m: MovementRow) => setReversing({ kind: "movement", id: m.id, label: `${MOVEMENT_TYPE_LABEL[m.movement_type]} de ${m.item_name}` });

  return (
    <StockShell
      description="Consumo interno, perdas, quebras, vencimentos e uso por paciente. A venda de produto baixa o estoque sozinha e aparece aqui."
      actions={canWrite ? <Button onClick={() => setCreating(true)}><Plus aria-hidden /> Nova saída</Button> : undefined}
    >
      {isLoading || (q.isLoading && canRead) ? <LoadingState /> : !canRead ? <NoAccess text="As saídas do estoque são do administrador, do gestor, do estoquista e do financeiro (consulta)." /> : (
        <div className="min-w-0 space-y-4">
          {!canWrite ? <Badge tone="muted">Consulta: você vê as saídas, mas não lança</Badge> : null}
          <FilterBar idPrefix="out" from={from} to={to} onFrom={setFrom} onTo={setTo} units={units} unitId={unitId} onUnit={setUnitId} />
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Tipo de saída" htmlFor="out-type">
              <NativeSelect id="out-type" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">Todas</option>
                {OUT_TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_TYPE_LABEL[t]}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <ExportButtons columns={movementExportColumns} rows={rows} filename="saidas-de-estoque" sheetName="Saídas" />
          {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
            <EmptyState icon={MinusCircle} title="Nenhuma saída no período" description="Registre o consumo interno, uma perda ou o uso por paciente." action={canWrite ? <Button onClick={() => setCreating(true)}>Nova saída</Button> : undefined} />
          ) : (
            <MovementTable rows={rows} label="Saídas de estoque" onReverse={canWrite ? reverse : undefined} />
          )}
        </div>
      )}
      {clinicId && creating ? <ExitDialog clinicId={clinicId} onClose={() => setCreating(false)} /> : null}
      <ReverseDialog target={reversing} onClose={() => setReversing(null)} />
    </StockShell>
  );
}
