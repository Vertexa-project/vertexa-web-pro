// Estoque › Relatórios (Entrega 8, escopo-v1 §8.8): posição e valor, movimentações, consumo por atendimento, perdas, validade, sem giro e compras. Filtros, totais e CSV/Excel/PDF.
import { useState } from "react";
import { FileText, FileX } from "lucide-react";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { ExportButtons, Field, FinTable, NativeSelect } from "@/components/fin/FinUi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinContext, useUnits } from "@/hooks/useFin";
import { useStockReport } from "@/hooks/useStockE8";
import type { ReportKey } from "@/lib/api/stockE8";
import { canSeeStockE8 } from "@/lib/domain/finAccess";
import { brDate, ITEM_TYPE_LABEL, REPORTS } from "@/lib/domain/stockE8";
import { exportColumns, REPORT_COLUMNS, REPORT_TOTAL_KEYS, totalText, type Row } from "@/lib/domain/stockReports";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import { NoAccess } from "@/pages/finance/NoAccess";
import { StockShell } from "@/pages/stock/StockShell";

function monthStart(today: string): string { return `${today.slice(0, 8)}01`; }

export function StockReportsTab() {
  const { clinicId, access, isLoading } = useFinContext();
  const canRead = canSeeStockE8(access);
  const units = (useUnits(clinicId, canRead).data ?? []).filter((u) => u.is_active);
  const today = todayIsoBR();
  const [report, setReport] = useState<ReportKey>("position");
  const [unitId, setUnitId] = useState("");
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [group, setGroup] = useState("service");
  const [window, setWindow] = useState("90");
  const [idleDays, setIdleDays] = useState("");
  const [category, setCategory] = useState("");
  const [itemType, setItemType] = useState("");
  const [pdfError, setPdfError] = useState<string | null>(null);
  const def = REPORTS.find((r) => r.key === report) ?? REPORTS[0];
  const params: Record<string, unknown> = {};
  if (report === "consumption") params.group = group;
  if (report === "validity") params.window = Number(window) || 90;
  if (report === "idle" && idleDays) params.days = Number(idleDays);
  if (report === "position") { if (category.trim()) params.category = category.trim(); if (itemType) params.item_type = itemType; }
  const periodOk = !def.period || (from !== "" && to !== "" && from <= to);
  const q = useStockReport(clinicId, report, { unitId: unitId || null, from: def.period ? from : undefined, to: def.period ? to : undefined, params }, canRead && periodOk);
  const data = q.data;
  const rows = (data?.rows ?? []) as Row[];
  const cols = REPORT_COLUMNS[report];
  const totals = REPORT_TOTAL_KEYS[report].map((t) => ({ ...t, value: data?.totals[t.key] ?? 0 }));
  const filename = `estoque-${report}-${today}`;

  const downloadPdf = () => {
    setPdfError(null);
    const unitName = units.find((u) => u.id === unitId)?.name ?? "Todas as unidades";
    void import("@/lib/pdf/generateStockReportPdf")
      .then((m) => m.downloadStockReportPdf({ filename, title: def.label, subtitle: `${unitName}${def.period ? ` · ${brDate(from)} a ${brDate(to)}` : ` · em ${brDate(today)}`} · ${rows.length} linha(s)`, columns: cols, rows, totals: totals.map((t) => `${t.label}: ${totalText(t.kind, t.value)}`) }))
      .catch(() => setPdfError("Não foi possível gerar o PDF agora."));
  };

  return (
    <StockShell description="Relatórios do estoque com filtros e totais. O total mostrado é a soma de todas as linhas do filtro.">
      {isLoading ? <LoadingState /> : !canRead ? <NoAccess text="Os relatórios de estoque são do administrador, do gestor, do estoquista e do financeiro (consulta)." /> : (
        <div className="min-w-0 space-y-4">
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Relatório" htmlFor="rp-kind" hint={def.hint} className="sm:col-span-2">
              <NativeSelect id="rp-kind" value={report} onChange={(e) => setReport(e.target.value as ReportKey)}>{REPORTS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</NativeSelect>
            </Field>
            <Field label="Unidade" htmlFor="rp-unit"><NativeSelect id="rp-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">Todas</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect></Field>
            {def.period ? (
              <>
                <Field label="De" htmlFor="rp-from"><Input id="rp-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="Até" htmlFor="rp-to" error={!periodOk ? "Informe um período válido." : null}><Input id="rp-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
              </>
            ) : null}
            {report === "consumption" ? <Field label="Agrupar por" htmlFor="rp-group"><NativeSelect id="rp-group" value={group} onChange={(e) => setGroup(e.target.value)}><option value="service">Serviço</option><option value="professional">Profissional</option><option value="item">Item</option></NativeSelect></Field> : null}
            {report === "validity" ? <Field label="Vence em até (dias)" htmlFor="rp-win"><Input id="rp-win" inputMode="numeric" value={window} onChange={(e) => setWindow(e.target.value.replace(/\D/g, ""))} /></Field> : null}
            {report === "idle" ? <Field label="Sem saída há (dias)" htmlFor="rp-idle" hint="Vazio = o combinado da clínica."><Input id="rp-idle" inputMode="numeric" value={idleDays} onChange={(e) => setIdleDays(e.target.value.replace(/\D/g, ""))} /></Field> : null}
            {report === "position" ? (
              <>
                <Field label="Categoria" htmlFor="rp-cat"><Input id="rp-cat" value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
                <Field label="Tipo" htmlFor="rp-type"><NativeSelect id="rp-type" value={itemType} onChange={(e) => setItemType(e.target.value)}><option value="">Todos</option>{Object.entries(ITEM_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Field>
              </>
            ) : null}
          </div>

          {q.isLoading && periodOk ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : !data ? null : (
            <>
              <div className="flex min-w-0 flex-wrap items-center gap-3" role="group" aria-label="Exportar relatório">
                <ExportButtons columns={exportColumns(report)} rows={rows} filename={filename} sheetName={def.label.slice(0, 30)} />
                <Button type="button" variant="outline" size="sm" disabled={rows.length === 0} onClick={downloadPdf}><FileText aria-hidden /> PDF</Button>
              </div>
              {pdfError ? <p className="text-sm text-destructive" role="alert">{pdfError}</p> : null}
              {data.truncated ? <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" role="alert">O relatório tem {data.count} linhas; a tela traz as {rows.length} primeiras. Os totais abaixo somam todas. Estreite o filtro para ver o resto.</p> : null}
              <dl className="grid min-w-0 grid-cols-2 gap-3 rounded-lg border bg-card p-3 sm:grid-cols-4" aria-label="Totais">
                <div className="min-w-0"><dt className="text-xs text-muted-foreground">Linhas</dt><dd className="font-semibold tabular-nums">{data.count}</dd></div>
                {totals.map((t) => <div key={t.key} className="min-w-0"><dt className="text-xs text-muted-foreground">{t.label}</dt><dd className="font-semibold tabular-nums">{totalText(t.kind, t.value)}</dd></div>)}
              </dl>
              {rows.length === 0 ? <EmptyState icon={FileX} title="Nada neste filtro" description="Ajuste a unidade, o período ou os filtros do relatório." /> : (
                <FinTable<Row>
                  label={def.label} rows={rows} rowKey={(r) => String(r.ord)}
                  columns={cols.map((c, i) => ({ header: c.header, role: i === 0 ? "title" as const : undefined, nowrap: c.kind !== "text", className: c.right ? "text-right tabular-nums" : undefined, headClassName: c.right ? "text-right" : undefined, wide: c.header === "Observações", cell: (r: Row) => c.text(r) }))}
                />
              )}
            </>
          )}
        </div>
      )}
    </StockShell>
  );
}
