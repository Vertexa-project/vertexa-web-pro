// Estoque › Entradas: documentos de entrada (saldo inicial, compra, XML da NF-e, bonificação). Nova entrada manual, importar XML, ver itens e estornar.
import { useState } from "react";
import { FileUp, PackagePlus, Plus } from "lucide-react";

import { ExportButtons, FinTable, FormDialog } from "@/components/fin/FinUi";
import { FilterBar } from "@/components/fin/FinFilters";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFinContext, useUnits } from "@/hooks/useFin";
import { useEntries, useMovements } from "@/hooks/useStockMoves";
import type { EntryRow } from "@/lib/api/stockMoves";
import { canMoveStock, canSeeStockMoves } from "@/lib/domain/finAccess";
import { formatBRL } from "@/lib/domain/finance";
import { ENTRY_TYPE_LABEL } from "@/lib/domain/stockMoves";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";
import { ManualEntryDialog } from "@/pages/stock/ManualEntryDialog";
import { MovementTable } from "@/pages/stock/MovementTable";
import { brDate } from "@/pages/stock/movementFormat";
import { ReverseDialog, type ReverseTarget } from "@/pages/stock/ReverseDialog";
import { StockShell } from "@/pages/stock/StockShell";
import { XmlImportDialog } from "@/pages/stock/XmlImportDialog";

function EntryItemsDialog({ clinicId, entry, onClose }: { clinicId: string; entry: EntryRow; onClose: () => void }) {
  const q = useMovements(clinicId, { entryId: entry.id });
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={`Itens da entrada${entry.invoice_number ? ` — NF ${entry.invoice_number}` : ""}`}
      description={`${ENTRY_TYPE_LABEL[entry.entry_type]} · ${entry.unit_name} · ${brDate(entry.received_on)}`} onSubmit={onClose} pending={false} error={null} readOnly wide>
      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : <MovementTable rows={q.data ?? []} label="Itens da entrada" />}
    </FormDialog>
  );
}

export function StockEntriesTab() {
  const { clinicId, access, isLoading } = useFinContext();
  const canRead = canSeeStockMoves(access);
  const canWrite = canMoveStock(access);
  const units = (useUnits(clinicId, canRead).data ?? []).filter((u) => u.is_active);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [unitId, setUnitId] = useState("");
  const [mode, setMode] = useState<null | "manual" | "xml">(null);
  const [viewing, setViewing] = useState<EntryRow | null>(null);
  const [reversing, setReversing] = useState<ReverseTarget | null>(null);
  const q = useEntries(clinicId, { unitId: unitId || null, from, to }, canRead);
  const rows = q.data ?? [];

  const columns: ExportColumn<EntryRow>[] = [
    { header: "Data", value: (e) => brDate(e.received_on) },
    { header: "Unidade", value: (e) => e.unit_name },
    { header: "Tipo", value: (e) => ENTRY_TYPE_LABEL[e.entry_type] },
    { header: "Fornecedor", value: (e) => e.supplier_name },
    { header: "Nota", value: (e) => e.invoice_number },
    { header: "Chave da NF-e", value: (e) => e.invoice_key },
    { header: "Linhas", value: (e) => e.lines_count, kind: "qty" },
    { header: "Itens (R$)", value: (e) => e.items_total_cents, kind: "money" },
    { header: "Frete (R$)", value: (e) => e.freight_cents, kind: "money" },
    { header: "Total (R$)", value: (e) => e.total_cents, kind: "money" },
    { header: "Situação", value: (e) => (e.status === "reversed" ? "Estornada" : "Ativa") },
    { header: "Motivo do estorno", value: (e) => e.reverse_reason },
    { header: "Lançada por", value: (e) => e.user_name },
    { header: "Observação", value: (e) => e.notes },
  ];

  return (
    <StockShell
      description="Saldo inicial, compras, notas por XML da NF-e e bonificações. Cada entrada recalcula o custo médio do item na unidade."
      actions={canWrite ? (
        <>
          <Button onClick={() => setMode("manual")}><Plus aria-hidden /> Nova entrada</Button>
          <Button variant="outline" onClick={() => setMode("xml")}><FileUp aria-hidden /> Importar XML da NF-e</Button>
        </>
      ) : undefined}
    >
      {isLoading || (q.isLoading && canRead) ? <LoadingState /> : !canRead ? <NoAccess text="As entradas do estoque são do administrador, do gestor, do estoquista e do financeiro (consulta)." /> : (
        <div className="min-w-0 space-y-4">
          {!canWrite ? <Badge tone="muted">Consulta: você vê as entradas, mas não lança</Badge> : null}
          <FilterBar idPrefix="ent" from={from} to={to} onFrom={setFrom} onTo={setTo} units={units} unitId={unitId} onUnit={setUnitId} />
          <ExportButtons columns={columns} rows={rows} filename="entradas-de-estoque" sheetName="Entradas" />
          {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
            <EmptyState icon={PackagePlus} title="Nenhuma entrada no período" description="Lance o saldo inicial, uma compra ou importe o XML da nota." action={canWrite ? <Button onClick={() => setMode("manual")}>Nova entrada</Button> : undefined} />
          ) : (
            <FinTable
              label="Entradas de estoque" rows={rows} rowKey={(e) => e.id}
              columns={[
                { header: "Entrada", role: "title", cell: (e) => <>{ENTRY_TYPE_LABEL[e.entry_type]}{e.invoice_number ? ` · NF ${e.invoice_number}` : ""}<span className="block text-xs font-normal text-muted-foreground">{e.unit_name} · {brDate(e.received_on)}</span></> },
                { header: "Situação", role: "badge", cell: (e) => <Badge tone={e.status === "reversed" ? "muted" : "success"}>{e.status === "reversed" ? "Estornada" : "Ativa"}</Badge> },
                { header: "Fornecedor", cell: (e) => e.supplier_name ?? "—" },
                { header: "Linhas", nowrap: true, cell: (e) => e.lines_count },
                { header: "Itens", nowrap: true, cell: (e) => formatBRL(e.items_total_cents) },
                { header: "Frete", nowrap: true, cell: (e) => formatBRL(e.freight_cents) },
                { header: "Total", nowrap: true, cell: (e) => formatBRL(e.total_cents) },
                { header: "Lançada por", cell: (e) => <span className="text-xs">{e.user_name ?? "—"}{e.reverse_reason ? <span className="block text-muted-foreground">Estorno: {e.reverse_reason}</span> : null}</span> },
                { header: "Ações", role: "action", cell: (e) => (
                  <span className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setViewing(e)} aria-label={`Ver itens da entrada ${e.invoice_number ?? ""}`}>Ver itens</Button>
                    {canWrite && e.status === "active" ? <Button size="sm" variant="outline" onClick={() => setReversing({ kind: "entry", id: e.id, label: `${ENTRY_TYPE_LABEL[e.entry_type]}${e.invoice_number ? ` da NF ${e.invoice_number}` : ""} (${e.unit_name})` })} aria-label={`Estornar entrada ${e.invoice_number ?? ""}`}>Estornar</Button> : null}
                  </span>
                ) },
              ]}
            />
          )}
        </div>
      )}
      {clinicId && mode === "manual" ? <ManualEntryDialog clinicId={clinicId} onClose={() => setMode(null)} /> : null}
      {clinicId && mode === "xml" ? <XmlImportDialog clinicId={clinicId} onClose={() => setMode(null)} /> : null}
      {clinicId && viewing ? <EntryItemsDialog clinicId={clinicId} entry={viewing} onClose={() => setViewing(null)} /> : null}
      <ReverseDialog target={reversing} onClose={() => setReversing(null)} />
    </StockShell>
  );
}
