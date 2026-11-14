// Financeiro › Repasse › Fechamento (Entrega 6): tabela do gestor por profissional, pendências, aprovação, travamento e exportações.
// Fluxo: iniciar (a partir do dia 1 do mês seguinte) → conferir/atualizar extratos → aceite do profissional → aprovar → pagar (NF + comprovante) → travar.
import { useState } from "react";
import { FileDown, Lock, LockOpen, RefreshCw, Send } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { ExportButtons, Field, FinTable, FormDialog, MonthYearPicker, NativeSelect } from "@/components/fin/FinUi";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAudit, useFinContext } from "@/hooks/useFin";
import { useApproveClosing, useClosing, useLockClosing, useNotifyClosing, useRefreshClosing, useStartClosing, useUnlockClosing } from "@/hooks/useFinClosing";
import { usePayoutContext } from "@/hooks/useFinPayout";
import { getPaymentFile } from "@/lib/api/finClosing";
import { canDecideClosing, canPayClosing, canPrepareClosing, canSeeClosing, canSeePayoutRules, canUnlockClosing, finCan } from "@/lib/domain/finAccess";
import {
  BOND_LABEL, CLOSING_STATUS_LABEL, NF_LABEL, SKIP_REASON_TEXT, acceptanceText, acceptanceTone, canSelectForApproval, closingErrorMessage, closingTableColumns, closingTone, nfTone, paymentFileColumns,
  paymentText, periodLabel, previousPeriod, notifiedText, closingHistoryRows, withholdingColumns, withholdingRows, type ClosingRow,
} from "@/lib/domain/finClosing";
import { formatBRL } from "@/lib/domain/finance";
import { CSV_MIME, downloadBlob, toCsv } from "@/lib/domain/tableExport";
import { todayIsoBR } from "@/lib/domain/stockMoves";
import { NoAccess } from "@/pages/finance/NoAccess";
import { StatementDialog } from "@/pages/finance/payout/closing/StatementDialog";

type Msg = { tone: "ok" | "warn" | "error"; text: string } | null;
const msgClass = { ok: "border-emerald-300 bg-emerald-50 text-emerald-900", warn: "border-amber-300 bg-amber-50 text-amber-900", error: "border-destructive/30 bg-destructive/5 text-destructive" };

export function ClosingTab() {
  const { clinicId, access } = useFinContext();
  const [params] = useSearchParams();
  const [period, setPeriod] = useState(() => (/^\d{4}-\d{2}$/.test(params.get("mes") ?? "") ? (params.get("mes") as string) : previousPeriod(todayIsoBR())));
  const [unitId, setUnitId] = useState(params.get("unidade") ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openStatement, setOpenStatement] = useState<string | null>(null);
  const [dlg, setDlg] = useState<null | "lock" | "unlock">(null);
  const [msg, setMsg] = useState<Msg>(null);
  const canRead = canSeeClosing(access);
  const ctx = usePayoutContext(clinicId, canRead).data;
  const q = useClosing(clinicId, period, unitId || null, canRead);
  const start = useStartClosing(clinicId ?? ""); const refresh = useRefreshClosing(); const notify = useNotifyClosing(); const approve = useApproveClosing(); const lock = useLockClosing(); const unlock = useUnlockClosing();
  const rows = q.data?.rows ?? [];
  if (!clinicId) return <LoadingState />;
  if (!canRead) return <NoAccess />;
  const v = q.data; const c = v?.closing ?? null;
  const status = c?.status ?? null; const locked = status === "travado";
  const prepare = canPrepareClosing(access); const decide = canDecideClosing(access); const pay = canPayClosing(access);
  const pend = v?.pendencies;
  const err = (e: unknown) => setMsg({ tone: "error", text: closingErrorMessage(e) });
  const selectable = rows.filter(canSelectForApproval);
  const toggle = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const approveIds = (ids: string[] | null) => {
    if (!c) return; setMsg(null);
    approve.mutate({ closingId: c.id, professionalIds: ids }, {
      onSuccess: (r) => {
        setPicked(new Set());
        const skipped = r.skipped.map((s) => `${s.name}: ${SKIP_REASON_TEXT[s.reason] ?? s.reason}`);
        setMsg(skipped.length === 0 ? { tone: "ok", text: `${r.approved} extrato(s) aprovado(s).` } : { tone: r.approved > 0 ? "warn" : "error", text: `${r.approved} aprovado(s). Não aprovados — ${skipped.join("; ")}.` });
      },
      onError: err,
    });
  };
  const payFile = async () => {
    if (!c) return; setMsg(null);
    try {
      const f = await getPaymentFile(c.id);
      if (f.rows.length === 0) { setMsg({ tone: "warn", text: "Nenhum profissional aprovado com valor a pagar." }); return; }
      downloadBlob(toCsv(paymentFileColumns, f.rows), `arquivo-de-pagamento-${period}.csv`, CSV_MIME);
      setMsg({ tone: "ok", text: `Arquivo de pagamento gerado com ${f.rows.length} profissional(is). O acesso a esses dados fica no histórico.` });
    } catch (e) { err(e); }
  };
  const columns = closingTableColumns(period);

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Field label="Competência" htmlFor="cl-period"><MonthYearPicker id="cl-period" value={period} onChange={(p) => { setPeriod(p); setPicked(new Set()); setMsg(null); }} /></Field>
        <Field label="Unidade" htmlFor="cl-unit">
          <NativeSelect id="cl-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Todas as unidades</option>
            {(ctx?.units ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </NativeSelect>
        </Field>
      </div>

      {q.isLoading ? <LoadingState /> : q.isError || !v ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium"><span>Fechamento de {periodLabel(period)}</span>{status ? <Badge tone={closingTone(status)}>{CLOSING_STATUS_LABEL[status]}</Badge> : <Badge tone="muted">Não iniciado</Badge>}</div>
            {c?.lock_no ? <p className="text-xs text-muted-foreground">{locked ? "Mês travado: nada muda; correções vão para o próximo mês aberto." : c.unlock_reason ? `Destravado: ${c.unlock_reason}` : null}</p> : null}
          </div>
          {msg ? <p className={`rounded-md border px-3 py-2 text-sm ${msgClass[msg.tone]}`} role={msg.tone === "error" ? "alert" : "status"}>{msg.text}</p> : null}

          {pend && (pend.unruled_count > 0 || pend.appointments_without_sale > 0 || pend.overdue_receivables > 0 || pend.negative_count > 0) ? (
            <div className="min-w-0 space-y-2" aria-label="Pendências do fechamento">
              {pend.unruled_count > 0 ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                  <p><strong>Bloqueia a aprovação:</strong> {pend.unruled_count} participante(s) de atendimento sem regra de repasse.{" "}
                    {canSeePayoutRules(access) ? <Link className="underline" to="/financeiro/repasse/regras">Criar a regra ou marcar «sem repasse»</Link> : null}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                    {pend.unruled.slice(0, 5).map((u) => <li key={`${u.appointment_id}-${u.professional_id}`} className="break-words">{u.professional_name} · {u.service_name} · {u.performed_on.split("-").reverse().join("/")}</li>)}
                  </ul>
                </div>
              ) : null}
              {pend.appointments_without_sale > 0 ? <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note">Aviso: {pend.appointments_without_sale} atendimento(s) realizado(s) no mês sem venda ligada.</p> : null}
              {pend.overdue_receivables > 0 ? <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note">Aviso: {pend.overdue_receivables} título(s) com vencimento até o fim do mês ainda não liquidado(s); o percentual só entra quando o dinheiro liquida.</p> : null}
              {pend.negative_count > 0 ? <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note">Alerta: {pend.negative_count} profissional(is) com total do mês negativo. Sem retenção; o saldo é levado ao mês seguinte.</p> : null}
            </div>
          ) : null}

          {!c ? (
            <EmptyState icon={FileDown} title="Fechamento ainda não iniciado" description={v.period_ended ? "Ao iniciar, o sistema gera o extrato de cada profissional com movimento no mês e avisa os profissionais para o aceite." : "O fechamento começa no dia 1 do mês seguinte. Enquanto isso, acompanhe a prévia em «Lançamentos»."}
              action={prepare && v.period_ended ? <Button onClick={() => { setMsg(null); start.mutate(period, { onSuccess: (r) => setMsg({ tone: "ok", text: `Fechamento iniciado com ${r.professionals} extrato(s).` }), onError: err }); }} disabled={start.isPending} aria-busy={start.isPending}>Iniciar fechamento</Button> : undefined} />
          ) : (
            <>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {prepare && !locked ? <Button variant="outline" size="sm" disabled={refresh.isPending} onClick={() => { setMsg(null); refresh.mutate({ closingId: c.id }, { onSuccess: (r) => setMsg({ tone: "ok", text: r.changed + r.added === 0 ? "Os extratos já estavam em dia." : `${r.changed} extrato(s) atualizado(s)${r.added ? `, ${r.added} novo(s)` : ""}.` }), onError: err }); }}><RefreshCw aria-hidden /> Atualizar extratos</Button> : null}
                {prepare && !locked ? <Button variant="outline" size="sm" disabled={notify.isPending} onClick={() => { setMsg(null); notify.mutate({ closingId: c.id, professionalIds: [...picked] }, { onSuccess: (n) => setMsg({ tone: "ok", text: `${n} profissional(is) notificado(s).` }), onError: err }); }}><Send aria-hidden /> Notificar profissionais</Button> : null}
                {decide && !locked ? <Button size="sm" disabled={approve.isPending || picked.size === 0} onClick={() => approveIds([...picked])}>Aprovar selecionados ({picked.size})</Button> : null}
                {decide && !locked ? <Button size="sm" variant="outline" disabled={approve.isPending || selectable.length === 0} onClick={() => approveIds(selectable.map((r) => r.professional_id))}>Aprovar todos prontos ({selectable.length})</Button> : null}
                {decide && !locked ? <Button size="sm" variant="outline" disabled={status !== "aprovado"} onClick={() => setDlg("lock")}><Lock aria-hidden /> Travar o mês</Button> : null}
                {canUnlockClosing(access) && locked ? <Button size="sm" variant="outline" onClick={() => setDlg("unlock")}><LockOpen aria-hidden /> Destravar</Button> : null}
                {pay ? <Button size="sm" variant="outline" onClick={() => void payFile()}><FileDown aria-hidden /> Arquivo de pagamento</Button> : null}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                <ExportButtons columns={columns} rows={rows} filename={`fechamento-${period}`} sheetName="Fechamento" label="Tabela" />
                <ExportButtons columns={withholdingColumns(period)} rows={withholdingRows(rows)} filename={`retencoes-${period}`} sheetName="Retenções" label="Retenções" />
                <Button type="button" variant="outline" size="sm" disabled={rows.length === 0} onClick={() => void import("@/lib/pdf/generateClosingPdf").then((m) => m.downloadClosingPdf(period, rows, v.totals)).catch(() => setMsg({ tone: "error", text: "Não foi possível gerar o PDF agora." }))}><FileDown aria-hidden /> PDF do fechamento</Button>
              </div>

              {rows.length === 0 ? <EmptyState icon={FileDown} title="Nenhum extrato nesta unidade" description="Nenhum profissional tem lançamento nesta unidade no mês." /> : (
                <>
                  <FinTable<ClosingRow>
                    label="Fechamento do mês por profissional" rows={rows} rowKey={(r) => r.id}
                    columns={[
                      {
                        header: "Profissional", role: "title",
                        cell: (r) => (
                          <label className="flex min-w-0 items-start gap-2">
                            {decide && !locked ? <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[hsl(24_95%_53%)]" checked={picked.has(r.professional_id)} onChange={() => toggle(r.professional_id)} aria-label={`Selecionar ${r.name}`} /> : null}
                            <span className="min-w-0 break-words">{r.name}{r.bond_type ? <span className="block text-xs font-normal text-muted-foreground">{BOND_LABEL[r.bond_type] ?? r.bond_type}</span> : null}<span className="block text-xs font-normal text-muted-foreground">{notifiedText(r.notified_at)}</span></span>
                          </label>
                        ),
                      },
                      { header: "Aceite", role: "badge", cell: (r) => <Badge tone={acceptanceTone(r.acceptance)} className="whitespace-normal text-center">{acceptanceText(r)}{r.open_disputes > 0 ? ` · ${r.open_disputes} contest.` : ""}</Badge> },
                      { header: "NF e pagamento", cell: (r) => <span className="flex min-w-0 flex-col items-start gap-1"><Badge tone={nfTone(r.nf_status)}>NF {NF_LABEL[r.nf_status].toLowerCase()}</Badge><span className="text-xs text-muted-foreground">{paymentText(r)}</span></span> },
                      ...(rows.some((x) => x.appointments !== 0) ? [{ header: "Atendimentos", nowrap: true, className: "tabular-nums", cell: (r: ClosingRow) => r.appointments }] : []),
                      { header: "Percentual", nowrap: true, className: "tabular-nums", cell: (r) => formatBRL(r.pct_cents) },
                      ...(rows.some((x) => x.fixed_exec_cents !== 0) ? [{ header: "Fixo por execução", nowrap: true, className: "tabular-nums", cell: (r: ClosingRow) => formatBRL(r.fixed_exec_cents) }] : []),
                      ...(rows.some((x) => x.fixed_monthly_cents !== 0) ? [{ header: "Fixo mensal", nowrap: true, className: "tabular-nums", cell: (r: ClosingRow) => formatBRL(r.fixed_monthly_cents) }] : []),
                      ...(rows.some((x) => x.guarantee_cents !== 0) ? [{ header: "Garantia", nowrap: true, className: "tabular-nums", cell: (r: ClosingRow) => formatBRL(r.guarantee_cents) }] : []),
                      ...(rows.some((x) => x.commission_cents !== 0) ? [{ header: "Comissões", nowrap: true, className: "tabular-nums", cell: (r: ClosingRow) => formatBRL(r.commission_cents) }] : []),
                      ...(rows.some((x) => x.usage_fee_cents !== 0) ? [{ header: "Taxa de uso", nowrap: true, className: "tabular-nums", cell: (r: ClosingRow) => formatBRL(r.usage_fee_cents) }] : []),
                      ...(rows.some((x) => x.adjustment_cents !== 0) ? [{ header: "Ajustes", nowrap: true, className: "tabular-nums", cell: (r: ClosingRow) => formatBRL(r.adjustment_cents) }] : []),
                      { header: "Total bruto", nowrap: true, className: "tabular-nums font-medium", cell: (r) => formatBRL(r.gross_cents) },
                      ...(rows.some((x) => x.withholding_cents !== 0) ? [{ header: "Retenções", nowrap: true, className: "tabular-nums", cell: (r: ClosingRow) => `−${formatBRL(r.withholding_cents)}` }] : []),
                      { header: "Líquido a pagar", nowrap: true, className: "tabular-nums font-semibold", cell: (r) => formatBRL(r.net_cents) },
                                            { header: "Ações", role: "action", cell: (r) => <Button size="sm" variant="outline" onClick={() => setOpenStatement(r.id)} aria-label={`Ver extrato de ${r.name}`}>Ver extrato</Button> },
                    ]}
                  />
                  <Card>
                    <CardContent className="min-w-0 p-4" aria-label="Total geral">
                      <p className="mb-2 text-sm font-medium">Total geral ({rows.length} profissional(is))</p>
                      <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
                        <div><dt className="text-xs text-muted-foreground">Percentual</dt><dd className="tabular-nums">{formatBRL(v.totals.pct_cents)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Fixos (execução + mensal)</dt><dd className="tabular-nums">{formatBRL(v.totals.fixed_exec_cents + v.totals.fixed_monthly_cents)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Garantia e comissões</dt><dd className="tabular-nums">{formatBRL(v.totals.guarantee_cents + v.totals.commission_cents)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Taxa de uso e ajustes</dt><dd className="tabular-nums">{formatBRL(v.totals.usage_fee_cents + v.totals.adjustment_cents)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Total bruto</dt><dd className="font-semibold tabular-nums">{formatBRL(v.totals.gross_cents)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Retenções</dt><dd className="tabular-nums">{v.totals.withholding_cents === 0 ? formatBRL(0) : `−${formatBRL(v.totals.withholding_cents)}`}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Líquido a pagar</dt><dd className="font-semibold tabular-nums">{formatBRL(v.totals.net_cents)}</dd></div>
                      </dl>
                    </CardContent>
                  </Card>
                  <p className="text-xs text-muted-foreground">O total bruto, as retenções e o líquido de cada linha são os mesmos do extrato do profissional.</p>
                </>
              )}
            </>
          )}
        </>
      )}

      {c && finCan(access, "audit") ? <ClosingHistory clinicId={clinicId} closingId={c.id} period={period} /> : null}
      {openStatement ? <StatementDialog statementId={openStatement} onClose={() => setOpenStatement(null)} /> : null}
      {dlg === "lock" && c ? (
        <ReasonDialog title="Travar o mês" description={`Depois de travado, ${periodLabel(period)} não muda: estorno ou correção posterior vira linha no próximo mês aberto. Só o responsável pela clínica destrava, com motivo.`} label="Observação (opcional)" required={false} submitLabel="Travar o mês" pending={lock.isPending}
          onClose={() => setDlg(null)} onSubmit={(reason, fail) => lock.mutate({ closingId: c.id, reason }, { onSuccess: () => { setDlg(null); setMsg({ tone: "ok", text: "Mês travado." }); }, onError: (e) => fail(closingErrorMessage(e)) })} />
      ) : null}
      {dlg === "unlock" && c ? (
        <ReasonDialog title="Destravar o mês" description="Os extratos ainda não pagos voltam para conferência e aceite. Quem já foi pago continua pago. O motivo fica no histórico." label="Motivo" required submitLabel="Destravar" pending={unlock.isPending}
          onClose={() => setDlg(null)} onSubmit={(reason, fail) => unlock.mutate({ closingId: c.id, reason: reason ?? "" }, { onSuccess: () => { setDlg(null); setMsg({ tone: "ok", text: "Mês destravado. Os extratos não pagos voltaram para conferência." }); }, onError: (e) => fail(closingErrorMessage(e)) })} />
      ) : null}
    </div>
  );
}

function ReasonDialog({ title, description, label, required, submitLabel, pending, onClose, onSubmit }: {
  title: string; description: string; label: string; required: boolean; submitLabel: string; pending: boolean; onClose: () => void; onSubmit: (reason: string | undefined, fail: (m: string) => void) => void;
}) {
  const [reason, setReason] = useState(""); const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog open onOpenChange={(o) => (!o ? onClose() : undefined)} title={title} description={description} submitLabel={submitLabel} pending={pending} error={error}
      onSubmit={() => { if (required && reason.trim().length < 3) { setError("Informe o motivo (mínimo de 3 letras)."); return; } setError(null); onSubmit(reason.trim() || undefined, setError); }}>
      <Field label={label} htmlFor="cl-reason"><Input id="cl-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
    </FormDialog>
  );
}

/** Histórico do mês (início, avisos, aprovações, pagamentos, travas e destravas com motivo), do registro de auditoria. */
function ClosingHistory({ clinicId, closingId, period }: { clinicId: string | null; closingId: string; period: string }) {
  const q = useAudit(clinicId, { entity: null, limit: 300 });
  const rows = closingHistoryRows(q.data ?? [], closingId, period);
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">Histórico do mês ({rows.length})</summary>
      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : rows.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nada registrado ainda.</p> : (
        <ol className="mt-2 min-w-0 space-y-2">
          {rows.map((h) => (
            <li key={h.id} className="min-w-0 border-l-2 pl-3 text-sm">
              <p className="break-words font-medium">{h.text}</p>
              <p className="text-xs text-muted-foreground">{h.when}{h.who ? ` · ${h.who}` : ""}</p>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
