// Financeiro › Painel (Entrega 7): indicadores do mês, pendências, evolução de 12 meses, blocos por forma de pagamento, profissional, serviço, agenda de recebimentos e produtos.
// Todo número é um botão: abre a lista de linhas que o compõe (F12), e a soma da lista é o número. Mês em português, padrão o mês atual de Brasília.
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, Clock, Coins, Package, Percent, Receipt, ShoppingBag, TrendingUp, Users } from "lucide-react";

import { Field, FinTable, MonthYearPicker, NativeSelect, type FinColumn } from "@/components/fin/FinUi";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFinContext, useUnits } from "@/hooks/useFin";
import { useDashboard } from "@/hooks/useFinDash";
import { canSeeDashboard } from "@/lib/domain/finAccess";
import {
  METRIC_INFO, PENDENCIES, REPASSE_NOTE, agendaLabel, closingNote, countText, currentPeriod, dashErrorMessage, dashUnits, evolutionLines, moneyText, pctText, periodLabel,
  type DashAgendaBucket, type DashEvolution, type DashMetric, type DashMethod, type DashParams, type DashProfessional, type DashService, type DashSummary, type DashTarget,
} from "@/lib/domain/finDash";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import { cn } from "@/lib/utils";
import { NoAccess } from "@/pages/finance/NoAccess";
import { alignHeads } from "@/pages/finance/dash/dashColumns";
import { DashDetailDialog } from "@/pages/finance/dash/DashDetailDialog";
import { StatementDialog } from "@/pages/finance/payout/closing/StatementDialog";

/** Número que abre a lista que o compõe. */
function NumBtn({ children, label, onClick, className }: { children: React.ReactNode; label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className={cn("tabular-nums rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
      {children}
    </button>
  );
}

type Tone = "default" | "success" | "warning" | "destructive";
const toneBar: Record<Tone, string> = { default: "bg-muted text-muted-foreground", success: "bg-success/10 text-success", warning: "bg-warning/15 text-warning-foreground", destructive: "bg-destructive/10 text-destructive" };

function KpiCard({ icon: Icon, label, value, sub, tone = "default", onClick, ariaLabel }: {
  icon: LucideIcon; label: string; value: string; sub?: string; tone?: Tone; onClick: () => void; ariaLabel: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel}
      className="min-w-0 rounded-lg border bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex min-w-0 items-start gap-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", toneBar[tone])}><Icon className="h-4 w-4" aria-hidden /></div>
        <div className="min-w-0">
          <p className="text-xs font-medium leading-tight text-muted-foreground">{label}</p>
          <p className="mt-1 break-words font-display text-xl font-bold leading-tight tracking-tight tabular-nums text-foreground">{value}</p>
          {sub ? <p className="mt-1 text-xs leading-tight text-muted-foreground">{sub}</p> : null}
        </div>
      </div>
    </button>
  );
}

function EvolutionChart({ evo }: { evo: DashEvolution[] }) {
  const lines = evolutionLines(evo);
  return (
    <div className="min-w-0 space-y-2">
      <svg viewBox="0 0 300 100" className="h-32 w-full" role="img" aria-label="Evolução dos últimos 12 meses: vendido, recebido e margem" preserveAspectRatio="none">
        {lines.map((l) => <polyline key={l.key} points={l.points} fill="none" stroke={l.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
        {lines.map((l) => <li key={l.key} className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-full" style={{ background: l.color }} aria-hidden />{l.label}</li>)}
      </ul>
    </div>
  );
}

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <section aria-label={title} className="min-w-0 space-y-3">
    <div><h2 className="text-base font-semibold text-foreground">{title}</h2>{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}</div>
    {children}
  </section>
);

export function DashboardTab() {
  const { clinicId, access, isLoading } = useFinContext();
  const [period, setPeriod] = useState(() => currentPeriod(todayIsoBR()));
  const [unitId, setUnitId] = useState("");
  const [target, setTarget] = useState<DashTarget | null>(null);
  const [statementId, setStatementId] = useState<string | null>(null);
  const canRead = canSeeDashboard(access);
  const unitsQ = useUnits(clinicId, canRead);
  const units = dashUnits(access, unitsQ.data ?? []);
  const q = useDashboard(clinicId, period, unitId || null, canRead);

  if (!clinicId || isLoading) return <LoadingState />;
  if (!canRead) return <NoAccess text="O painel financeiro é do administrador, do gestor e do financeiro." />;

  const s = q.data;
  const unit = unitId || null;
  const open = (metric: DashMetric, title: string, params?: DashParams, p: string = period) => setTarget({ metric, period: p, unitId: unit, params, title });
  const money = (c: number) => moneyText(c);

  return (
    <div className="min-w-0 space-y-6">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Field label="Mês" htmlFor="dash-period"><MonthYearPicker id="dash-period" value={period} onChange={setPeriod} /></Field>
        <Field label="Unidade" htmlFor="dash-unit">
          <NativeSelect id="dash-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">{units.length > 1 || units.length === 0 ? "Todas as unidades" : "Todas as minhas unidades"}</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </NativeSelect>
        </Field>
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3" aria-busy="true">{Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : q.isError || !s ? (
        <ErrorState description={dashErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <DashboardBody s={s} money={money} open={open} openStatement={setStatementId} />
      )}

      {target ? <DashDetailDialog key={`${target.metric}|${target.period}|${JSON.stringify(target.params ?? {})}`} target={target} onClose={() => setTarget(null)} /> : null}
      {statementId ? <StatementDialog statementId={statementId} onClose={() => setStatementId(null)} /> : null}
    </div>
  );
}

function DashboardBody({ s, money, open, openStatement }: {
  s: DashSummary; money: (c: number) => string; open: (m: DashMetric, title: string, params?: DashParams, p?: string) => void; openStatement: (id: string) => void;
}) {
  const c = s.cards;
  const label = (m: DashMetric) => METRIC_INFO[m].title;
  const card = (metric: DashMetric, icon: LucideIcon, value: string, sub: string, tone: Tone = "default") => (
    <KpiCard icon={icon} label={label(metric)} value={value} sub={sub} tone={tone} onClick={() => open(metric, label(metric))} ariaLabel={`${label(metric)}: ${value}. Ver a lista que compõe este número`} />
  );

  const methodCols: FinColumn<DashMethod>[] = [
    { header: "Forma de pagamento", role: "title", cell: (m) => m.label },
    { header: "Títulos", cell: (m) => m.count, className: "text-right" },
    { header: "Recebido", cell: (m) => <NumBtn label={`Ver os títulos recebidos em ${m.label}: ${money(m.cents)}`} onClick={() => open("received", `Recebido — ${m.label}`, { method: m.key })}>{money(m.cents)}</NumBtn>, className: "text-right", nowrap: true },
  ];
  const proCols: FinColumn<DashProfessional>[] = [
    { header: "Profissional", role: "title", cell: (p) => p.name },
    { header: "Atendimentos", cell: (p) => <NumBtn label={`Ver os atendimentos de ${p.name}: ${p.appointments}`} onClick={() => open("pro_appointments", `Atendimentos — ${p.name}`, { professional: p.professional_id })}>{p.appointments}</NumBtn>, className: "text-right" },
    { header: "Receita gerada", cell: (p) => <NumBtn label={`Ver a receita gerada por ${p.name}: ${money(p.revenue_cents)}`} onClick={() => open("pro_appointments", `Receita gerada — ${p.name}`, { professional: p.professional_id })}>{money(p.revenue_cents)}</NumBtn>, className: "text-right", nowrap: true },
    {
      header: "Repasse",
      cell: (p) => <NumBtn label={`Ver o repasse de ${p.name}: ${money(p.repasse_cents)}`}
        onClick={() => (p.repasse_source === "closing" && p.closing_pro_id ? openStatement(p.closing_pro_id) : open("pro_lines", `Lançamentos de ${p.name}`, { professional: p.professional_id }))}>{money(p.repasse_cents)}</NumBtn>,
      className: "text-right", nowrap: true,
    },
    { header: "% repassado", cell: (p) => pctText(p.pct_repassed), className: "text-right", nowrap: true },
    { header: "Margem gerada", cell: (p) => <NumBtn label={`Ver a margem gerada por ${p.name}: ${money(p.margin_cents)}`} onClick={() => open("pro_margin", `Margem gerada — ${p.name}`, { professional: p.professional_id })}>{money(p.margin_cents)}</NumBtn>, className: "text-right", nowrap: true },
  ];
  const svcCols: FinColumn<DashService>[] = [
    { header: "Serviço", role: "title", cell: (v) => v.name },
    { header: "Quantidade", cell: (v) => <NumBtn label={`Ver os atendimentos de ${v.name}: ${v.quantity}`} onClick={() => open("service_appointments", `Atendimentos — ${v.name}`, { service: v.service_id })}>{v.quantity}</NumBtn>, className: "text-right" },
    { header: "Receita", cell: (v) => <NumBtn label={`Ver a receita de ${v.name}: ${money(v.revenue_cents)}`} onClick={() => open("service_appointments", `Receita — ${v.name}`, { service: v.service_id })}>{money(v.revenue_cents)}</NumBtn>, className: "text-right", nowrap: true },
    { header: "Custo médio de material", cell: (v) => <NumBtn label={`Ver o material de ${v.name}: média ${money(v.avg_material_cents)}`} onClick={() => open("service_appointments", `Material — ${v.name}`, { service: v.service_id })}>{money(v.avg_material_cents)}</NumBtn>, className: "text-right", nowrap: true },
    { header: "Margem por unidade", cell: (v) => money(v.unit_margin_cents), className: "text-right", nowrap: true },
  ];
  const agendaCols: FinColumn<DashAgendaBucket>[] = [
    { header: "Faixa", role: "title", cell: (b) => agendaLabel(b) },
    { header: "Títulos", cell: (b) => b.count, className: "text-right" },
    { header: "A receber", cell: (b) => (b.count === 0 ? money(0) : <NumBtn label={`Ver os títulos de ${agendaLabel(b)}: ${money(b.cents)}`} onClick={() => open("to_receive", `A receber — ${agendaLabel(b)}`, { from: b.from, to: b.to })}>{money(b.cents)}</NumBtn>), className: "text-right", nowrap: true },
  ];
  const evoCols: FinColumn<DashEvolution>[] = [
    { header: "Mês", role: "title", cell: (e) => periodLabel(e.period) },
    { header: "Vendido", cell: (e) => <NumBtn label={`Ver as vendas de ${periodLabel(e.period)}: ${money(e.sold_cents)}`} onClick={() => open("sold", `Vendido — ${periodLabel(e.period)}`, undefined, e.period)}>{money(e.sold_cents)}</NumBtn>, className: "text-right", nowrap: true },
    { header: "Recebido", cell: (e) => <NumBtn label={`Ver o recebido de ${periodLabel(e.period)}: ${money(e.received_cents)}`} onClick={() => open("received", `Recebido — ${periodLabel(e.period)}`, undefined, e.period)}>{money(e.received_cents)}</NumBtn>, className: "text-right", nowrap: true },
    { header: "Margem", cell: (e) => <NumBtn label={`Ver a margem de ${periodLabel(e.period)}: ${money(e.margin_cents)}`} onClick={() => open("margin", `Margem da clínica — ${periodLabel(e.period)}`, undefined, e.period)}>{money(e.margin_cents)}</NumBtn>, className: "text-right", nowrap: true },
  ];

  const repasseSub = closingNote(s.closing_status, s.all_units);
  const od = c.overdue_count;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3" aria-label="Indicadores do mês">
        {card("sold", ShoppingBag, money(c.sold_cents), countText(c.sold_count, "venda", "vendas"))}
        {card("received", CheckCircle2, money(c.received_cents), "Títulos liquidados no mês", "success")}
        {card("to_receive", Clock, money(c.to_receive_cents), countText(c.to_receive_count, "título", "títulos"))}
        {card("overdue", AlertTriangle, money(c.overdue_cents), od === 0 ? "Nada em atraso" : `${countText(c.overdue_titles_count, "título", "títulos")} e ${countText(c.overdue_sales_count, "venda", "vendas")}`, od > 0 ? "destructive" : "success")}
        {card("fees", Percent, money(c.fees_cents), "Taxas dos títulos liquidados")}
        {card("repasse", Users, money(c.repasse_cents), repasseSub)}
        {card("material", Package, money(c.material_cents), "Atendimentos realizados no mês")}
        {card("margin", TrendingUp, money(c.margin_cents), "Recebido − taxas − imposto − material − repasses − produtos", c.margin_cents < 0 ? "destructive" : "default")}
        {card("ticket", Receipt, c.ticket_cents === null ? "—" : money(c.ticket_cents), "Vendido ÷ vendas")}
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">Repasses: {REPASSE_NOTE} Em atraso: títulos vencidos e vendas sem recebimento há mais de {s.overdue_days} dias. A receber e Em atraso não dependem do mês escolhido.</p>

      <Section title="Pendências" hint="Filas para resolver. Clique para ver a lista.">
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
          {PENDENCIES.map((p) => {
            const v = s.pendencies[p.key]; const n = v?.count ?? 0;
            return (
              <button key={p.key} type="button" onClick={() => open(p.metric, p.label)} aria-label={`${p.label}: ${n}. Ver a lista`}
                className="flex min-w-0 items-center justify-between gap-3 rounded-lg border bg-card p-3 text-left hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0 text-sm font-medium">{p.label}{p.showCents && n > 0 ? <span className="block text-xs font-normal text-muted-foreground tabular-nums">{money(v.cents)}</span> : null}</span>
                <Badge tone={n > 0 ? "warning" : "success"}>{n}</Badge>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Evolução mensal" hint="Últimos 12 meses: vendido, recebido e margem. Clique no valor de um mês para ver a lista.">
        <Card><CardContent className="min-w-0 space-y-4 p-4"><EvolutionChart evo={s.evolution} /></CardContent></Card>
        <FinTable label="Evolução mensal" rows={[...s.evolution].reverse()} rowKey={(e) => e.period} columns={alignHeads(evoCols)} />
      </Section>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <Section title="Recebido por forma de pagamento">
          {s.by_method.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum recebimento liquidado neste mês.</p> : <FinTable label="Recebido por forma de pagamento" rows={s.by_method} rowKey={(m) => m.key} columns={alignHeads(methodCols)} />}
        </Section>
        <Section title="Agenda de recebimentos" hint="Próximos 90 dias, por semana, a partir de hoje.">
          <FinTable label="Agenda de recebimentos" rows={s.agenda} rowKey={(b) => b.from} columns={alignHeads(agendaCols)} />
        </Section>
      </div>

      <Section title="Por profissional" hint="Receita gerada = atendimentos que o profissional respondeu. Margem gerada = receita − repasse − material.">
        {s.by_professional.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum atendimento realizado neste mês.</p> : <FinTable label="Por profissional" rows={s.by_professional} rowKey={(p) => p.professional_id} columns={alignHeads(proCols)} />}
      </Section>

      <Section title="Por serviço">
        {s.by_service.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum atendimento realizado neste mês.</p> : <FinTable label="Por serviço" rows={s.by_service} rowKey={(v) => v.service_id} columns={alignHeads(svcCols)} />}
      </Section>

      <Section title="Produtos" hint="Receita de revenda, custo, comissões e margem do mês.">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="min-w-0 rounded-lg border bg-card p-3"><dt className="text-xs text-muted-foreground">Receita de produtos</dt><dd><NumBtn label={`Ver a receita de produtos: ${money(c.products_revenue_cents)}`} onClick={() => open("products_revenue", label("products_revenue"))}>{money(c.products_revenue_cents)}</NumBtn></dd></div>
          <div className="min-w-0 rounded-lg border bg-card p-3"><dt className="text-xs text-muted-foreground">Custo dos produtos vendidos</dt><dd><NumBtn label={`Ver o custo dos produtos: ${money(c.products_cost_cents)}`} onClick={() => open("products_cost", label("products_cost"))}>{money(c.products_cost_cents)}</NumBtn></dd></div>
          <div className="min-w-0 rounded-lg border bg-card p-3"><dt className="text-xs text-muted-foreground">Comissões</dt><dd><NumBtn label={`Ver as comissões: ${money(c.products_commission_cents)}`} onClick={() => open("products_commission", label("products_commission"))}>{money(c.products_commission_cents)}</NumBtn></dd></div>
          <div className="min-w-0 rounded-lg border bg-card p-3"><dt className="text-xs text-muted-foreground">Margem de produtos</dt><dd className="tabular-nums font-medium"><Coins className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" aria-hidden />{money(c.products_margin_cents)}</dd></div>
        </dl>
      </Section>

      <p className="text-xs text-muted-foreground">
        Imposto: <NumBtn label={`Ver o imposto: ${money(c.tax_cents)}`} onClick={() => open("tax", label("tax"))}>{money(c.tax_cents)}</NumBtn> (alíquota do mês de cada unidade × recebido). Meses em horário de Brasília.
      </p>
    </>
  );
}
