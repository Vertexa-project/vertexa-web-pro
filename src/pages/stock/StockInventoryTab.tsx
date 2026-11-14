// Estoque › Inventário (Entrega 8, escopo-v1 §8.6): contagem cega por unidade, revisão das diferenças pelo gestor e aprovação que lança os ajustes com motivo.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ClipboardList, Plus } from "lucide-react";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { ExportButtons, Field, FinTable, NativeSelect } from "@/components/fin/FinUi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFinContext, useUnits } from "@/hooks/useFin";
import { useInventories } from "@/hooks/useStockE8";
import type { InventoryRow } from "@/lib/api/stockE8";
import { canManageInventory, canSeeStockE8 } from "@/lib/domain/finAccess";
import { brDate, brDateTime, INVENTORY_STATUS_LABEL, moneyOrZero, SCOPE_LABEL } from "@/lib/domain/stockE8";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";
import { InventoryDetail } from "@/pages/stock/e8/InventoryDetail";
import { OpenInventoryDialog } from "@/pages/stock/e8/InventoryDialogs";
import { StockShell } from "@/pages/stock/StockShell";

const TONE = { counting: "info", review: "warning", approved: "success", canceled: "muted" } as const;
const scopeText = (r: InventoryRow) => (r.scope === "all" ? SCOPE_LABEL.all : `${SCOPE_LABEL[r.scope]}: ${r.scope_value}`);

export function StockInventoryTab() {
  const { clinicId, access, isLoading } = useFinContext();
  const canRead = canSeeStockE8(access);
  const manage = canManageInventory(access);
  const units = (useUnits(clinicId, canRead).data ?? []).filter((u) => u.is_active);
  const [params, setParams] = useSearchParams();
  const openId = params.get("id");
  const [unitId, setUnitId] = useState("");
  const [status, setStatus] = useState("");
  const [opening, setOpening] = useState(false);
  const q = useInventories(clinicId, { unitId: unitId || null, status }, canRead);
  const rows = q.data ?? [];
  const current = openId ? rows.find((r) => r.id === openId) : undefined;
  const go = (id: string | null) => setParams(id ? { id } : {}, { replace: false });
  const columns: ExportColumn<InventoryRow>[] = [
    { header: "Nº", value: (r) => r.number }, { header: "Nome", value: (r) => r.name }, { header: "Unidade", value: (r) => r.unit_name }, { header: "Escopo", value: (r) => scopeText(r) }, { header: "Situação", value: (r) => INVENTORY_STATUS_LABEL[r.status] },
    { header: "Aberto em", value: (r) => brDateTime(r.frozen_at) }, { header: "Itens", value: (r) => r.lines_total, kind: "qty" }, { header: "Contados", value: (r) => r.lines_counted, kind: "qty" },
    { header: "Linhas com diferença", value: (r) => r.lines_with_difference, kind: "qty" }, { header: "Sobra (R$)", value: (r) => r.increase_cents, kind: "money" }, { header: "Falta (R$)", value: (r) => r.decrease_cents, kind: "money" },
  ];

  return (
    <StockShell description="Contagem física por unidade. Na contagem cega, quem conta não vê o saldo esperado; o gestor revisa as diferenças e aprova os ajustes."
      actions={canRead && manage && !current ? <Button onClick={() => setOpening(true)}><Plus aria-hidden /> Abrir inventário</Button> : undefined}>
      {isLoading || (q.isLoading && canRead) ? <LoadingState /> : !canRead ? <NoAccess text="O inventário é do administrador, do gestor e do estoquista (contagem); o financeiro consulta." /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : current && clinicId ? (
        <InventoryDetail key={current.id} inv={current} access={access} clinicId={clinicId} onBack={() => go(null)} />
      ) : (
        <div className="min-w-0 space-y-4">
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Unidade" htmlFor="iv-f-unit"><NativeSelect id="iv-f-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">Todas</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect></Field>
            <Field label="Situação" htmlFor="iv-f-status"><NativeSelect id="iv-f-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option><option value="counting">Em contagem</option><option value="review">Em revisão</option><option value="approved">Aprovados</option><option value="canceled">Cancelados</option></NativeSelect></Field>
          </div>
          <ExportButtons columns={columns} rows={rows} filename="inventarios" sheetName="Inventários" />
          {openId && !current ? <p className="text-sm text-muted-foreground" role="status">Inventário não encontrado neste filtro.</p> : null}
          {rows.length === 0 ? (
            <EmptyState icon={ClipboardList} title="Nenhum inventário" description={manage ? "Abra um inventário para congelar o saldo e iniciar a contagem física." : "Quando o gestor abrir um inventário, ele aparece aqui para a contagem."} />
          ) : (
            <FinTable<InventoryRow>
              label="Inventários" rows={rows} rowKey={(r) => r.id}
              columns={[
                { header: "Inventário", role: "title", cell: (r) => `Nº ${r.number}${r.name ? ` · ${r.name}` : ""} · ${r.unit_name}` },
                { header: "Situação", role: "badge", cell: (r) => <Badge tone={TONE[r.status]}>{INVENTORY_STATUS_LABEL[r.status]}</Badge> },
                { header: "Escopo", wide: true, cell: (r) => `${scopeText(r)}${r.blind ? " · contagem cega" : ""}` },
                { header: "Aberto", nowrap: true, cell: (r) => brDate(r.frozen_at) },
                { header: "Contagem", nowrap: true, cell: (r) => `${r.lines_counted} de ${r.lines_total}` },
                { header: "Diferenças", nowrap: true, cell: (r) => (r.lines_with_difference === null ? "—" : r.lines_with_difference === 0 ? "nenhuma" : `${r.lines_with_difference} (${moneyOrZero((r.increase_cents ?? 0) + (r.decrease_cents ?? 0))})`) },
                { header: "Ações", role: "action", cell: (r) => (
                  <Button size="sm" variant={r.status === "counting" && r.can_count ? "default" : "outline"} onClick={() => go(r.id)} aria-label={`${r.status === "counting" && r.can_count ? "Contar" : r.status === "review" && r.can_review ? "Revisar" : "Ver"} inventário ${r.number}`}>
                    {r.status === "counting" && r.can_count ? "Contar" : r.status === "review" && r.can_review ? "Revisar" : "Ver"}
                  </Button>) },
              ]}
            />
          )}
          {opening && clinicId ? <OpenInventoryDialog clinicId={clinicId} units={units} defaultUnit={unitId} onClose={() => setOpening(false)} onOpened={(id) => go(id)} /> : null}
        </div>
      )}
    </StockShell>
  );
}
