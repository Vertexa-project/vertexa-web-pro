// Financeiro › Repasse › Lançamentos: prévia do mês e linhas de repasse por profissional/competência, com a memória de cálculo.
// Gestor/Financeiro/Admin escolhem o profissional; o profissional vê só os próprios. Recepção e Estoquista não chegam aqui.
import { useState } from "react";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import { Calculator, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

import { ExportButtons, Field, FinTable, MonthYearPicker, NativeSelect } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFinContext } from "@/hooks/useFin";
import { usePayoutContext, usePayoutLines, usePayoutMonth, usePayoutMonthAll, useRecalcPayout } from "@/hooks/useFinPayout";
import type { PayoutLineRow } from "@/lib/api/finPayout";
import { canRecalcPayout, canSeeAllPayouts, canSeePayout, canSeePayoutRules } from "@/lib/domain/finAccess";
import { formatBRL } from "@/lib/domain/finance";
import { PAYOUT_LINE_LABEL, PAYOUT_ROLE_LABEL, payoutErrorMessage } from "@/lib/domain/finPayout";
import { periodName } from "@/lib/domain/taxRate";
import type { ExportColumn } from "@/lib/domain/tableExport";
import { NoAccess } from "@/pages/finance/NoAccess";
import { PayoutMemoryDialog } from "@/pages/finance/payout/PayoutMemoryDialog";

const br = (iso: string | null) =>
  !iso ? "—" : iso.length > 10 ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : iso.split("-").reverse().join("/");
const thisMonth = () => todayIsoBR().slice(0, 7);
const lineTitle = (l: PayoutLineRow) => (l.kind === "correction" ? (l.line_type === "adjustment" ? "Estorno / ajuste" : "Correção") : PAYOUT_LINE_LABEL[l.line_type]);

export function PayoutLinesTab() {
  const { clinicId, access } = useFinContext();
  const manager = canSeeAllPayouts(access);
  const [period, setPeriod] = useState(thisMonth());
  const [professionalId, setProfessionalId] = useState("");
  const [memory, setMemory] = useState<PayoutLineRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const canRead = canSeePayout(access);
  const ctx = usePayoutContext(clinicId, canRead && manager).data;
  const all = usePayoutMonthAll(clinicId, period, canRead && manager);
  const target = manager ? professionalId || null : null;
  const ready = canRead && (!manager || Boolean(professionalId));
  const month = usePayoutMonth(clinicId, target, period, ready);
  const lines = usePayoutLines(clinicId, { professionalId: target, period }, ready);
  const recalc = useRecalcPayout(clinicId ?? "");
  if (!clinicId) return <LoadingState />;
  if (!canRead) return <NoAccess />;
  const rows = lines.data ?? [];
  const m = month.data;
  const names = new Map((ctx?.professionals ?? []).map((p) => [p.id, p.name]));
  const columns: ExportColumn<PayoutLineRow>[] = [
    { header: "Extrato", value: (l) => `${l.period.slice(5)}/${l.period.slice(0, 4)}` }, { header: "Profissional", value: (l) => l.professional_name }, { header: "Data", value: (l) => br(l.source_date) },
    { header: "Paciente", value: (l) => l.patient ?? "" }, { header: "Serviço", value: (l) => l.service_name ?? "" }, { header: "Papel", value: (l) => (l.role ? PAYOUT_ROLE_LABEL[l.role] : "") },
    { header: "Tipo", value: lineTitle }, { header: "Base (R$)", value: (l) => l.base_cents, kind: "money" }, { header: "%", value: (l) => l.pct ?? "" }, { header: "Valor (R$)", value: (l) => l.amount_cents, kind: "money" },
  ];
  const runRecalc = () => {
    setNotice(null); setRecalcError(null);
    recalc.mutate({}, { onSuccess: (r) => setNotice(r.lines_created === 0 ? "Tudo já estava calculado: nenhum lançamento novo." : `Recalculado: ${r.lines_created} lançamento(s) novo(s).`), onError: (e) => setRecalcError(payoutErrorMessage(e)) });
  };

  return (
    <div className="min-w-0 space-y-4">
      {!manager ? <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm" role="note">Você vê só o seu repasse. Cada valor mostra como foi calculado.</p> : null}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Field label="Competência (extrato)" htmlFor="pay-period"><MonthYearPicker id="pay-period" value={period} onChange={setPeriod} /></Field>
        {manager ? (
          <Field label="Profissional" htmlFor="pay-pro">
            <NativeSelect id="pay-pro" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
              <option value="">Selecione…</option>
              {(ctx?.professionals ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </Field>
        ) : null}
      </div>

      {manager ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Repasse de {periodName(period)} por profissional <span className="font-normal text-muted-foreground">(prévia, ainda sem fechamento)</span></p>
            {canRecalcPayout(access) ? <Button variant="outline" size="sm" onClick={runRecalc} disabled={recalc.isPending} aria-busy={recalc.isPending}><RefreshCw aria-hidden /> Recalcular repasse</Button> : null}
          </div>
          {notice ? <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">{notice}</p> : null}
          {recalcError ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{recalcError}</p> : null}
          {(all.data?.unruled_count ?? 0) > 0 ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
              {all.data?.unruled_count} participante(s) de atendimentos deste mês estão <strong>sem regra de repasse</strong>.{" "}
              {canSeePayoutRules(access) ? <Link className="underline" to="/financeiro/repasse/regras">Criar a regra ou marcar «sem repasse»</Link> : null}
            </p>
          ) : null}
          {all.isLoading ? <LoadingState /> : all.isError ? <ErrorState onRetry={() => void all.refetch()} /> : (all.data?.professionals.length ?? 0) === 0 ? (
            <EmptyState icon={Calculator} title="Nenhum repasse até este mês" description="Os lançamentos aparecem quando o atendimento é realizado e o dinheiro liquida. Cadastre as regras em «Regras»." />
          ) : (
            <FinTable
              label="Repasse do mês por profissional" rows={all.data?.professionals ?? []} rowKey={(r) => r.professional_id}
              columns={[
                { header: "Profissional", role: "title", cell: (r) => r.name },
                { header: "Alerta", role: "badge", cell: (r) => (r.negative ? <Badge tone="warning">Saldo negativo</Badge> : null) },
                { header: "Total bruto", nowrap: true, className: "tabular-nums", cell: (r) => formatBRL(r.gross_total_cents) },
                { header: "Retenções", nowrap: true, className: "tabular-nums", cell: (r) => formatBRL(r.withholding_total_cents) },
                { header: "Líquido a pagar", nowrap: true, className: "tabular-nums", cell: (r) => formatBRL(r.net_total_cents) },
                { header: "Ações", role: "action", cell: (r) => <Button size="sm" variant="outline" onClick={() => setProfessionalId(r.professional_id)} aria-label={`Ver lançamentos de ${r.name}`}>Ver lançamentos</Button> },
              ]}
            />
          )}
        </div>
      ) : null}

      {ready ? (
        <div className="min-w-0 space-y-3">
          {month.isLoading ? <LoadingState /> : month.isError ? <ErrorState onRetry={() => void month.refetch()} /> : m ? (
            <Card>
              <CardContent className="min-w-0 space-y-3 p-4">
                <p className="text-sm font-medium">{manager ? (names.get(professionalId) ?? "Profissional") : "Meu repasse"} · {periodName(period)}</p>
                <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">Percentual</dt><dd className="tabular-nums">{formatBRL(m.persisted.pct)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Fixo por execução</dt><dd className="tabular-nums">{formatBRL(m.persisted.fixed_exec)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Comissões</dt><dd className="tabular-nums">{formatBRL(m.persisted.commission)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Estornos e ajustes</dt><dd className="tabular-nums">{formatBRL(m.persisted.adjustment)}</dd></div>
                  {m.derived.map((d, i) => <div key={`${d.line_type}-${i}`} className="min-w-0"><dt className="text-xs text-muted-foreground">{d.line_type === "adjustment" ? "Saldo negativo trazido" : PAYOUT_LINE_LABEL[d.line_type]}</dt><dd className="tabular-nums">{formatBRL(d.amount_cents)}</dd></div>)}
                  <div><dt className="text-xs text-muted-foreground">Total bruto</dt><dd className="font-semibold tabular-nums">{formatBRL(m.gross_total_cents)}</dd></div>
                  {m.withholdings.map((w) => <div key={w.rule_type}><dt className="text-xs text-muted-foreground">Retenção {w.label ?? w.rule_type.toUpperCase()} ({String(w.rate_pct).replace(".", ",")}%)</dt><dd className="tabular-nums">{w.waived ? "dispensada" : `−${formatBRL(w.amount_cents)}`}</dd></div>)}
                  <div><dt className="text-xs text-muted-foreground">Líquido a pagar</dt><dd className="font-semibold tabular-nums">{formatBRL(m.net_total_cents)}</dd></div>
                </dl>
                {m.negative ? <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">O total do mês ficou negativo: sem retenção e o saldo é levado ao mês seguinte.</p> : null}
                <p className="text-xs text-muted-foreground">Prévia do mês: faixas, fixo mensal, garantia e taxa de uso são recalculados no fechamento.</p>
              </CardContent>
            </Card>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3"><ExportButtons columns={columns} rows={rows} filename="repasse" sheetName="Repasse" /></div>
          {lines.isLoading ? <LoadingState /> : lines.isError ? <ErrorState onRetry={() => void lines.refetch()} /> : rows.length === 0 ? (
            <EmptyState icon={Calculator} title="Nenhum lançamento neste mês" description="O repasse percentual entra no mês em que o dinheiro liquida; o fixo por execução, no mês do atendimento." />
          ) : (
            <FinTable<PayoutLineRow>
              label="Lançamentos de repasse" rows={rows} rowKey={(l) => l.id}
              columns={[
                { header: "Serviço", role: "title", cell: (l) => l.service_name ?? "—" },
                { header: "Tipo", role: "badge", cell: (l) => <Badge tone={l.amount_cents < 0 ? "warning" : l.kind === "correction" ? "info" : "muted"}>{lineTitle(l)}</Badge> },
                { header: "Data", nowrap: true, cell: (l) => br(l.source_date) },
                { header: "Paciente", cell: (l) => l.patient ?? "—" },
                { header: "Papel", cell: (l) => (l.role ? PAYOUT_ROLE_LABEL[l.role] : "—") },
                { header: "Base", nowrap: true, className: "tabular-nums", cell: (l) => (l.base_cents === null ? "—" : formatBRL(l.base_cents)) },
                { header: "%", nowrap: true, className: "tabular-nums", cell: (l) => (l.pct === null ? "—" : `${String(l.pct).replace(".", ",")}%`) },
                { header: "Valor", nowrap: true, className: "tabular-nums font-medium", cell: (l) => formatBRL(l.amount_cents) },
                { header: "Ações", role: "action", cell: (l) => <Button size="sm" variant="outline" onClick={() => setMemory(l)} aria-label={`Ver como foi calculado: ${l.service_name ?? "lançamento"}`}>Como foi calculado</Button> },
              ]}
            />
          )}
        </div>
      ) : manager ? <p className="text-sm text-muted-foreground">Escolha um profissional para ver os lançamentos e a memória de cálculo.</p> : null}
      {memory ? <PayoutMemoryDialog line={memory} onClose={() => setMemory(null)} /> : null}
    </div>
  );
}
