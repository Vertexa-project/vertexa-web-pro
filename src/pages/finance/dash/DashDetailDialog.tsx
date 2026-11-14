// Lista que compõe um número do painel (F12): tabela (cartões no celular), total = soma das linhas, exportação e abertura em cadeia (margem → componente, repasse → extrato).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ExportButtons, FinTable } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDashDetail } from "@/hooks/useFinDash";
import { useFinContext } from "@/hooks/useFin";
import { getDashboardDetail } from "@/lib/api/finDash";
import { canSeeAppointments, canSeeCash, canSeePatientPackages, canSeePayout, canSeePayoutRules, canSeeReceivables, canSeeSales, canSeeStockMoves, type FinAccess } from "@/lib/domain/finAccess";
import { METRIC_INFO, countText, dashErrorMessage, detailExportColumns, moneyText, periodLabel, str, type DashMetric, type DashRow, type DashTarget } from "@/lib/domain/finDash";
import { METRIC_HAS_VALUE, detailColumns } from "@/pages/finance/dash/dashColumns";
import { StatementDialog } from "@/pages/finance/payout/closing/StatementDialog";

/** Listas que não dependem do mês escolhido (filas e agenda). */
const NOT_BY_MONTH: DashMetric[] = ["to_receive", "overdue", "overdue_titles", "appt_no_sale", "unruled", "packages", "cash", "stock"];

/** Tela existente onde o mesmo assunto é trabalhado (só aparece se o papel alcança a tela). */
function contextLink(metric: DashMetric, a: FinAccess): { to: string; label: string } | null {
  const pick = (ok: boolean, to: string, label: string) => (ok ? { to, label } : null);
  switch (metric) {
    case "sold": case "ticket": case "overdue": return pick(canSeeSales(a), "/financeiro/vendas", "Ir para Vendas");
    case "received": case "fees": case "to_receive": case "overdue_titles": return pick(canSeeReceivables(a), "/financeiro/titulos", "Ir para Títulos");
    case "repasse": return pick(canSeePayout(a), "/financeiro/repasse/fechamento", "Ir para o Fechamento");
    case "material": case "appt_no_sale": case "pro_appointments": case "service_appointments": return pick(canSeeAppointments(a), "/financeiro/atendimentos", "Ir para Atendimentos");
    case "unruled": return pick(canSeePayoutRules(a), "/financeiro/repasse/regras", "Criar a regra ou marcar «sem repasse»");
    case "packages": return pick(canSeePatientPackages(a), "/financeiro/pacotes", "Ir para Pacotes dos pacientes");
    case "cash": return pick(canSeeCash(a), "/financeiro/caixa", "Ir para o Caixa");
    case "stock": return pick(canSeeStockMoves(a), "/estoque/saldo", "Ir para o Saldo do estoque");
    case "products_cost": return pick(canSeeStockMoves(a), "/estoque/movimentacoes", "Ir para as Movimentações");
    default: return null;
  }
}

export function DashDetailDialog({ target, onClose }: { target: DashTarget; onClose: () => void }) {
  const { clinicId, access } = useFinContext();
  const [stack, setStack] = useState<DashTarget[]>([target]);
  const [statementId, setStatementId] = useState<string | null>(null);
  const [more, setMore] = useState<{ rows: DashRow[]; truncated: boolean } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const current = stack[stack.length - 1];
  const q = useDashDetail(clinicId, current);
  const key = `${current.metric}|${current.period}|${current.unitId}|${JSON.stringify(current.params ?? {})}`;
  useEffect(() => { setMore(null); setMoreError(null); }, [key]);

  const first = q.data;
  const rows = useMemo(() => [...(first?.rows ?? []), ...(more?.rows ?? [])], [first, more]);
  const truncated = more ? more.truncated : first?.truncated ?? false;
  const hasValue = METRIC_HAS_VALUE[current.metric];
  const info = METRIC_INFO[current.metric];
  const link = contextLink(current.metric, access);

  const drill = (row: DashRow) => {
    const push = (t: DashTarget) => setStack((s) => [...s, t]);
    const m = str(row.metric) as DashMetric;
    if (current.metric === "margin" && m) push({ metric: m, period: current.period, unitId: current.unitId, title: METRIC_INFO[m]?.title ?? str(row.label) });
    else if (current.metric === "pro_margin") {
      const prof = current.params?.professional;
      if (m === "pro_appointments") push({ metric: "pro_appointments", period: current.period, unitId: current.unitId, params: { professional: prof }, title: `${str(row.label)} — atendimentos` });
      else push({ metric: "pro_lines", period: current.period, unitId: current.unitId, params: { professional: prof }, title: "Lançamentos de repasse" });
    } else if (current.metric === "repasse") push({ metric: "pro_lines", period: current.period, unitId: current.unitId, params: { professional: row.id }, title: `Lançamentos de ${str(row.name)}` });
  };
  const columns = useMemo(() => detailColumns(current.metric, { onDrill: drill, onStatement: setStatementId }), [current]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = async () => {
    if (!clinicId) return;
    setMoreBusy(true); setMoreError(null);
    try {
      const page = await getDashboardDetail(clinicId, current.metric, current.period, current.unitId, current.params ?? {}, rows.length);
      setMore({ rows: [...(more?.rows ?? []), ...page.rows], truncated: page.truncated });
    } catch (e) { setMoreError(dashErrorMessage(e)); } finally { setMoreBusy(false); }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
        <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{current.title}</DialogTitle>
            <DialogDescription>{info.hint}{NOT_BY_MONTH.includes(current.metric) ? "" : ` Mês: ${periodLabel(current.period)}.`}</DialogDescription>
          </DialogHeader>
          <DialogBody className="min-w-0 space-y-3">
            {stack.length > 1 ? <div><Button type="button" size="sm" variant="outline" onClick={() => setStack((s) => s.slice(0, -1))}>Voltar</Button></div> : null}
            {q.isLoading ? <LoadingState /> : q.isError || !first ? <ErrorState onRetry={() => void q.refetch()} /> : (
              <>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2" aria-live="polite">
                  <p className="text-sm font-medium" data-testid="dash-total">
                    {hasValue ? <>Total: <span className="tabular-nums">{moneyText(first.total_cents)}</span> · </> : null}{countText(first.count, "linha", "linhas")}
                    {current.metric === "ticket" && first.count > 0 ? <> · Ticket médio: <span className="tabular-nums">{moneyText(Math.round(first.total_cents / first.count))}</span></> : null}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {link ? <Button asChild size="sm" variant="outline"><Link to={link.to}>{link.label}</Link></Button> : null}
                    <ExportButtons columns={detailExportColumns(current.metric)} rows={rows} filename={`painel-${current.metric}-${current.period}`} sheetName={current.title.slice(0, 30)} />
                  </div>
                </div>
                {rows.length === 0 ? <EmptyState title="Nada por aqui" description="Nenhuma linha compõe este número." /> : (
                  <FinTable label={current.title} rows={rows} rowKey={(r) => r.id} columns={columns} />
                )}
                {truncated ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-xs text-muted-foreground">Mostrando {rows.length} de {first.count} linhas. O total acima já soma todas.</p>
                    <Button type="button" size="sm" variant="outline" onClick={() => void loadMore()} disabled={moreBusy} aria-busy={moreBusy}>Carregar mais</Button>
                  </div>
                ) : null}
                {moreError ? <p className="text-sm text-destructive" role="alert">{moreError}</p> : null}
              </>
            )}
          </DialogBody>
          <DialogFooter><Button type="button" onClick={onClose}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {statementId ? <StatementDialog statementId={statementId} onClose={() => setStatementId(null)} /> : null}
    </>
  );
}
