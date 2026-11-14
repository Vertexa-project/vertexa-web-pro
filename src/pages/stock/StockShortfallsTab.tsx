// Estoque › Consumo sem saldo (Entrega 4, escopo-v1 §8.5 item 4): baixa de kit que não tinha saldo. O atendimento foi salvo; aqui o gestor/estoquista resolve com
// a baixa retroativa (depois de lançar a entrada) ou por ajuste. Alerta ao gestor: a aba mostra o total em aberto.
import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { ExportButtons, Field, FinTable, NativeSelect } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFinContext, useUnits } from "@/hooks/useFin";
import { useResolveShortfall, useShortfalls } from "@/hooks/useFinAppointments";
import type { ShortfallRow } from "@/lib/api/finAppointments";
import { canMoveStock, canSeeStockMoves } from "@/lib/domain/finAccess";
import { apptErrorMessage } from "@/lib/domain/finAppointments";
import { formatBRL } from "@/lib/domain/finance";
import { formatQty } from "@/lib/domain/stockMoves";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";
import { ReasonDialog } from "@/pages/finance/appointments/ReasonDialog";
import { StockShell } from "@/pages/stock/StockShell";

const br = (iso: string | null) =>
  !iso ? "—" : iso.length > 10 ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : iso.split("-").reverse().join("/");
const STATUS_LABEL: Record<ShortfallRow["status"], string> = { open: "Em aberto", resolved: "Resolvido", reversed: "Estornado" };
const RESOLUTION_LABEL = { retro_entry: "Baixa retroativa", adjustment: "Ajuste", reversed: "Atendimento cancelado/corrigido" } as const;

export function StockShortfallsTab() {
  const { clinicId, access, isLoading } = useFinContext();
  const canRead = canSeeStockMoves(access);
  const canWrite = canMoveStock(access);
  const units = (useUnits(clinicId, canRead).data ?? []).filter((u) => u.is_active);
  const [unitId, setUnitId] = useState("");
  const [status, setStatus] = useState("open");
  const [target, setTarget] = useState<{ row: ShortfallRow; mode: "retro" | "adjust" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useShortfalls(clinicId, { unitId: unitId || null, status }, canRead);
  const resolve = useResolveShortfall();
  const rows = q.data ?? [];
  const openTotal = rows.filter((r) => r.status === "open").length;
  const columns: ExportColumn<ShortfallRow>[] = [
    { header: "Data do atendimento", value: (r) => br(r.occurred_on) }, { header: "Unidade", value: (r) => r.unit_name }, { header: "Item", value: (r) => r.item_name },
    { header: "Quantidade", value: (r) => r.qty, kind: "qty" }, { header: "Unidade de estoque", value: (r) => r.stock_unit }, { header: "Custo estimado (R$)", value: (r) => r.est_cost_cents, kind: "money" },
    { header: "Serviço", value: (r) => r.service_name }, { header: "Paciente", value: (r) => r.patient_name }, { header: "Situação", value: (r) => STATUS_LABEL[r.status] },
    { header: "Como foi resolvido", value: (r) => (r.resolution ? RESOLUTION_LABEL[r.resolution] : "") }, { header: "Motivo", value: (r) => r.resolve_reason },
  ];

  return (
    <StockShell description="Quando o kit de um atendimento não tem saldo, o atendimento é salvo e a baixa fica aqui como «consumo sem saldo», até a entrada retroativa ou o ajuste.">
      {isLoading || (q.isLoading && canRead) ? <LoadingState /> : !canRead ? <NoAccess text="O consumo sem saldo é do administrador, do gestor, do estoquista e do financeiro (consulta)." /> : (
        <div className="min-w-0 space-y-4">
          {status === "open" && openTotal > 0 ? (
            <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {openTotal} {openTotal === 1 ? "baixa" : "baixas"} de atendimento sem saldo para regularizar. Lance a entrada que faltou e dê a baixa retroativa, ou resolva por ajuste.
            </p>
          ) : null}
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Unidade" htmlFor="sf-unit">
              <NativeSelect id="sf-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">Todas</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect>
            </Field>
            <Field label="Situação" htmlFor="sf-status">
              <NativeSelect id="sf-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="open">Em aberto</option><option value="resolved">Resolvidos</option><option value="reversed">Estornados</option><option value="">Todos</option>
              </NativeSelect>
            </Field>
          </div>
          <ExportButtons columns={columns} rows={rows} filename="consumo-sem-saldo" sheetName="Consumo sem saldo" />
          {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
            <EmptyState icon={CheckCircle2} title={status === "open" ? "Nada em aberto" : "Nenhum registro"} description="Toda baixa de kit teve saldo. Se faltar estoque num atendimento, ele aparece aqui." />
          ) : (
            <FinTable<ShortfallRow>
              label="Consumo sem saldo" rows={rows} rowKey={(r) => r.id}
              columns={[
                { header: "Item", role: "title", cell: (r) => r.item_name },
                { header: "Situação", role: "badge", cell: (r) => <Badge tone={r.status === "open" ? "warning" : "muted"}>{STATUS_LABEL[r.status]}</Badge> },
                { header: "Faltou", nowrap: true, cell: (r) => `${formatQty(r.qty)} ${r.stock_unit}` },
                { header: "Custo estimado", nowrap: true, className: "tabular-nums", cell: (r) => formatBRL(r.est_cost_cents) },
                { header: "Atendimento", wide: true, cell: (r) => `${r.service_name} · ${r.patient_name ?? "paciente"} · ${br(r.occurred_on)} · ${r.unit_name}` },
                { header: "Resolvido por", wide: true, cell: (r) => (r.resolution ? `${RESOLUTION_LABEL[r.resolution]}${r.resolve_reason ? ` — ${r.resolve_reason}` : ""}` : "—") },
                { header: "Ações", role: "action", cell: (r) => (canWrite && r.status === "open" ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => { setError(null); setTarget({ row: r, mode: "retro" }); }} aria-label={`Dar baixa retroativa de ${r.item_name}`}>Dar baixa</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setError(null); setTarget({ row: r, mode: "adjust" }); }} aria-label={`Resolver por ajuste ${r.item_name}`}>Resolver por ajuste</Button>
                  </>
                ) : null) },
              ]}
            />
          )}
          {target ? (
            <ReasonDialog
              title={target.mode === "retro" ? "Baixa retroativa" : "Resolver por ajuste"} submitLabel={target.mode === "retro" ? "Dar baixa" : "Resolver"} pending={resolve.isPending} error={error}
              label={target.mode === "retro" ? "Referência da entrada (ex.: NF lançada)" : "Como foi regularizado"}
              description={target.mode === "retro"
                ? `Lance antes a entrada que faltou. A baixa de ${formatQty(target.row.qty)} ${target.row.stock_unit} de ${target.row.item_name} leva a data do atendimento (${br(target.row.occurred_on)}) e o custo do atendimento passa da estimativa para o custo real.`
                : "Use quando a diferença foi regularizada por fora (inventário, acerto). Não mexe no estoque nem no custo do atendimento."}
              onClose={() => setTarget(null)}
              onSubmit={(reason) => { setError(null); resolve.mutate({ id: target.row.id, mode: target.mode, reason }, { onSuccess: () => setTarget(null), onError: (e) => setError(apptErrorMessage(e)) }); }}
            />
          ) : null}
        </div>
      )}
    </StockShell>
  );
}
