// Estoque › Alertas (Entrega 8, escopo-v1 §8.8): abaixo do mínimo, lote vencendo (janelas configuráveis), lote vencido, consumo sem saldo e transferência parada. Cada alerta leva à tela que resolve.
import { useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, CheckCircle2, Settings2 } from "lucide-react";

import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Field, FinTable, FormDialog, NativeSelect } from "@/components/fin/FinUi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinContext, useUnits } from "@/hooks/useFin";
import { useSaveAlertSettings, useStockAlerts } from "@/hooks/useStockE8";
import type { AlertSettings } from "@/lib/api/stockE8";
import { canConfigureStockAlerts, canSeeStockE8 } from "@/lib/domain/finAccess";
import { brDate, e8ErrorMessage, moneyOrZero } from "@/lib/domain/stockE8";
import { formatQty } from "@/lib/domain/stockMoves";
import { NoAccess } from "@/pages/finance/NoAccess";
import { StockShell } from "@/pages/stock/StockShell";

function Section({ title, count, tone, children }: { title: string; count: number; tone: "destructive" | "warning" | "info"; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="min-w-0 space-y-2" aria-label={title}>
      <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">{title} <Badge tone={tone}>{count}</Badge></h2>
      {children}
    </section>
  );
}

function SettingsDialog({ clinicId, settings, onClose }: { clinicId: string; settings: AlertSettings; onClose: () => void }) {
  const [days, setDays] = useState(settings.expiry_days.join(", "));
  const [idle, setIdle] = useState(String(settings.idle_days));
  const [transfer, setTransfer] = useState(String(settings.transfer_days));
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ days?: string; idle?: string; transfer?: string }>({});
  const save = useSaveAlertSettings(clinicId);
  const submit = () => {
    const list = days.split(/[,;\s]+/).filter(Boolean).map(Number);
    const e: typeof fieldErr = {};
    if (list.length < 1 || list.length > 5 || list.some((d) => !Number.isInteger(d) || d < 1 || d > 365)) e.days = "Informe de 1 a 5 prazos, de 1 a 365 dias (ex.: 90, 60, 30).";
    const i = Number(idle); if (!Number.isInteger(i) || i < 7 || i > 730) e.idle = "De 7 a 730 dias.";
    const t = Number(transfer); if (!Number.isInteger(t) || t < 1 || t > 60) e.transfer = "De 1 a 60 dias.";
    setFieldErr(e); setError(null);
    if (e.days || e.idle || e.transfer) return;
    save.mutate({ settings: { expiry_days: list, idle_days: i, transfer_days: t }, reason: "" }, { onSuccess: onClose, onError: (err) => setError(e8ErrorMessage(err)) });
  };
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title="Janelas dos alertas" description="Ficam registradas no Histórico." pending={save.isPending} error={error} onSubmit={submit}>
      <Field label="Avisar lote que vence em (dias, separados por vírgula)" htmlFor="al-days" error={fieldErr.days}><Input id="al-days" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
      <Field label="Item sem giro a partir de (dias)" htmlFor="al-idle" error={fieldErr.idle}><Input id="al-idle" inputMode="numeric" value={idle} onChange={(e) => setIdle(e.target.value)} /></Field>
      <Field label="Transferência parada em trânsito há mais de (dias)" htmlFor="al-tr" error={fieldErr.transfer}><Input id="al-tr" inputMode="numeric" value={transfer} onChange={(e) => setTransfer(e.target.value)} /></Field>
    </FormDialog>
  );
}

export function StockAlertsTab() {
  const { clinicId, access, isLoading } = useFinContext();
  const canRead = canSeeStockE8(access);
  const units = (useUnits(clinicId, canRead).data ?? []).filter((u) => u.is_active);
  const [unitId, setUnitId] = useState("");
  const [config, setConfig] = useState(false);
  const q = useStockAlerts(clinicId, unitId || null, canRead);
  const a = q.data;
  const unitLink = (to: string, label: string) => <Link className="text-primary underline-offset-4 hover:underline" to={to}>{label}</Link>;

  return (
    <StockShell description="O que precisa de atenção no estoque: itens abaixo do mínimo, lotes vencendo ou vencidos, consumo sem saldo e transferências paradas."
      actions={canConfigureStockAlerts(access) && a ? <Button variant="outline" onClick={() => setConfig(true)}><Settings2 aria-hidden /> Janelas dos alertas</Button> : undefined}>
      {isLoading || (q.isLoading && canRead) ? <LoadingState /> : !canRead ? <NoAccess text="Os alertas de estoque são do administrador, do gestor, do estoquista e do financeiro (consulta)." /> : q.isError || !a ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <div className="min-w-0 space-y-6">
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Unidade" htmlFor="al-unit"><NativeSelect id="al-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">Todas</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</NativeSelect></Field>
          </div>
          {a.counts.total === 0 ? <EmptyState icon={CheckCircle2} title="Nenhum alerta" description="Nenhum item abaixo do mínimo, lote vencendo ou vencido, consumo sem saldo ou transferência parada." /> : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><BellRing className="h-4 w-4" aria-hidden /> {a.counts.total} {a.counts.total === 1 ? "alerta" : "alertas"} · vencimento avisado a {a.settings.expiry_days.join(", ")} dias</p>
          )}

          <Section title="Lotes vencidos" count={a.counts.expired} tone="destructive">
            <FinTable label="Lotes vencidos" rows={a.expired} rowKey={(r) => r.lot_id} columns={[
              { header: "Item", role: "title", cell: (r) => `${r.item_name} · ${r.unit_name}` },
              { header: "Vencido há", role: "badge", cell: (r) => <Badge tone="destructive">{r.days_late} {r.days_late === 1 ? "dia" : "dias"}</Badge> },
              { header: "Lote", cell: (r) => `${r.lot_code} · ${brDate(r.expiry_date)}` },
              { header: "Saldo", nowrap: true, cell: (r) => `${formatQty(r.qty)} ${r.stock_unit}` },
              { header: "Valor", nowrap: true, className: "tabular-nums", cell: (r) => moneyOrZero(r.value_cents) },
              { header: "Ações", role: "action", cell: () => unitLink("/estoque/saidas", "Dar baixa como vencimento") },
            ]} />
          </Section>
          <Section title="Lotes vencendo" count={a.counts.expiring} tone="warning">
            <FinTable label="Lotes vencendo" rows={a.expiring} rowKey={(r) => r.lot_id} columns={[
              { header: "Item", role: "title", cell: (r) => `${r.item_name} · ${r.unit_name}` },
              { header: "Vence em", role: "badge", cell: (r) => <Badge tone={r.days_left <= 30 ? "destructive" : "warning"}>{r.days_left === 0 ? "hoje" : `${r.days_left} ${r.days_left === 1 ? "dia" : "dias"}`}</Badge> },
              { header: "Lote", cell: (r) => `${r.lot_code} · ${brDate(r.expiry_date)}` },
              { header: "Saldo", nowrap: true, cell: (r) => `${formatQty(r.qty)} ${r.stock_unit}` },
              { header: "Valor", nowrap: true, className: "tabular-nums", cell: (r) => moneyOrZero(r.value_cents) },
              { header: "Ações", role: "action", cell: () => unitLink("/estoque/saldo", "Ver saldo") },
            ]} />
          </Section>
          <Section title="Abaixo do mínimo" count={a.counts.below_min} tone="warning">
            <FinTable label="Itens abaixo do mínimo" rows={a.below_min} rowKey={(r) => `${r.item_id}:${r.unit_id}`} columns={[
              { header: "Item", role: "title", cell: (r) => `${r.item_name} · ${r.unit_name}` },
              { header: "Falta", role: "badge", cell: (r) => <Badge tone="warning">{formatQty(r.missing_qty)} {r.stock_unit}</Badge> },
              { header: "Saldo / mínimo", nowrap: true, cell: (r) => `${formatQty(r.qty_on_hand)} / ${formatQty(r.min_qty)} ${r.stock_unit}` },
              { header: "Ações", role: "action", cell: () => unitLink("/estoque/entradas", "Lançar entrada") },
            ]} />
          </Section>
          <Section title="Consumo sem saldo" count={a.counts.shortfalls} tone="warning">
            <FinTable label="Consumo sem saldo" rows={a.shortfalls} rowKey={(r) => r.id} columns={[
              { header: "Item", role: "title", cell: (r) => `${r.item_name} · ${r.unit_name}` },
              { header: "Faltou", nowrap: true, cell: (r) => `${formatQty(r.qty)} ${r.stock_unit}` },
              { header: "Atendimento", nowrap: true, cell: (r) => brDate(r.occurred_on) },
              { header: "Custo estimado", nowrap: true, className: "tabular-nums", cell: (r) => moneyOrZero(r.est_cost_cents) },
              { header: "Ações", role: "action", cell: () => unitLink("/estoque/sem-saldo", "Resolver") },
            ]} />
          </Section>
          <Section title="Transferências paradas" count={a.counts.stale_transfers} tone="info">
            <FinTable label="Transferências paradas" rows={a.stale_transfers} rowKey={(r) => r.id} columns={[
              { header: "Transferência", role: "title", cell: (r) => `Nº ${r.number} · ${r.from_unit_name} → ${r.to_unit_name}` },
              { header: "Parada há", role: "badge", cell: (r) => <Badge tone="destructive">{r.age_days} dias</Badge> },
              { header: "Itens", nowrap: true, cell: (r) => r.lines },
              { header: "Valor", nowrap: true, className: "tabular-nums", cell: (r) => moneyOrZero(r.sent_cents) },
              { header: "Ações", role: "action", cell: () => unitLink("/estoque/transferencias", "Abrir transferências") },
            ]} />
          </Section>
          {config && clinicId ? <SettingsDialog clinicId={clinicId} settings={a.settings} onClose={() => setConfig(false)} /> : null}
        </div>
      )}
    </StockShell>
  );
}
