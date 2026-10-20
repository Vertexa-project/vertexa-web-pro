import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Wallet } from "lucide-react";

import { StatCard } from "@/components/dashboard/StatCard";
import { ErrorState } from "@/components/feedback/ErrorState";
import { BillingDialog } from "@/components/finance/BillingDialog";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCancelCharge, useFinanceCharges, useFinanceOverview, useFinancePatients, useGenerateCharges, useMarkPaid, useReopenCharge } from "@/hooks/useFinance";
import { useClinicBrand } from "@/hooks/useClinicBrand";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import { formatBRL, monthInRange, monthShort, monthStart, monthTitle, shiftMonth, statusText, type FinanceCharge, type FinancePatient } from "@/lib/domain/finance";

const tone = (c: FinanceCharge) => (c.status === "paid" ? "success" : c.status === "canceled" ? "muted" : c.overdue ? "destructive" : "warning");

export function FinancePage() {
  const brand = useClinicBrand();
  const clinicId = brand.data?.clinicId ?? null;
  const { isClinicAdmin, isLoading: adminLoading } = useIsClinicAdmin(clinicId);
  const today = monthStart(new Date());
  const [month, setMonth] = useState(today);
  const [editing, setEditing] = useState<FinancePatient | null>(null);
  const gen = useGenerateCharges();
  const generated = useRef<string>("");
  const enabled = isClinicAdmin ? clinicId : null;
  const overview = useFinanceOverview(enabled, month);
  const charges = useFinanceCharges(enabled, month);
  const patients = useFinancePatients(enabled);
  const pay = useMarkPaid();
  const reopen = useReopenCharge();
  const cancel = useCancelCharge();

  // Gera (de forma idempotente) as cobranças do mês exibido.
  useEffect(() => {
    if (!enabled || !monthInRange(month, today)) return;
    const k = `${enabled}:${month}`;
    if (generated.current === k) return;
    generated.current = k;
    gen.mutate({ clinicId: enabled, month });
  }, [enabled, month, today, gen]);

  if (!adminLoading && !isClinicAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Financeiro" description="Receita da clínica." />
        <p className="text-sm text-muted-foreground" role="note">Esta área é só para o administrador da clínica.</p>
      </div>
    );
  }

  const o = overview.data;
  const list = charges.data ?? [];
  const busy = pay.isPending || reopen.isPending || cancel.isPending;
  const projMax = o ? Math.max(1, ...o.projection.map((p) => p.expected_cents)) : 1;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Financeiro"
        description="Controle manual das mensalidades dos pacientes: o que está previsto, recebido e em atraso."
        actions={
          <div className="flex items-center gap-1" role="group" aria-label="Mês">
            <Button variant="outline" size="icon" aria-label="Mês anterior" disabled={!monthInRange(shiftMonth(month, -1), today)} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-40 text-center text-sm font-medium capitalize text-foreground" aria-live="polite">{monthTitle(month.slice(0, 7))}</span>
            <Button variant="outline" size="icon" aria-label="Próximo mês" disabled={!monthInRange(shiftMonth(month, 1), today)} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        }
      />

      {overview.isLoading || adminLoading ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : overview.isError || !o ? (
        <ErrorState onRetry={() => overview.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
            <StatCard icon={Wallet} label="Previsto no mês" value={formatBRL(o.expected_cents)} tone="primary" />
            <StatCard icon={CheckCircle2} label="Recebido" value={formatBRL(o.received_cents)} tone="success" />
            <StatCard icon={Clock} label="A receber no prazo" value={formatBRL(o.pending_cents)} tone="warning" />
            <StatCard icon={AlertTriangle} label={`Em atraso (${o.overdue_count})`} value={formatBRL(o.overdue_cents)} tone={o.overdue_count > 0 ? "destructive" : "success"} />
            <StatCard icon={AlertTriangle} label={`Receita em risco (${o.at_risk_patients})`} value={formatBRL(o.at_risk_cents)} tone={o.at_risk_patients > 0 ? "warning" : "success"} />
          </div>
          <p className="-mt-4 text-xs text-muted-foreground">Receita em risco: mensalidade dos pacientes com cobrança ativa que estão há 14 dias ou mais sem registrar nada no app.</p>

          <section aria-label="Cobranças do mês" className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">Cobranças de {monthTitle(month.slice(0, 7))}</h2>
            {charges.isLoading ? <Skeleton className="h-24 w-full" /> : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma cobrança neste mês. Defina o valor dos pacientes abaixo para gerar as cobranças.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr>
                    <th className="px-4 py-2 font-medium">Paciente</th><th className="px-4 py-2 font-medium">Vencimento</th><th className="px-4 py-2 font-medium">Valor</th><th className="px-4 py-2 font-medium">Situação</th><th className="px-4 py-2" />
                  </tr></thead>
                  <tbody>
                    {list.map((c) => (
                      <tr key={c.charge_id} className="border-t border-border">
                        <td className="px-4 py-3 font-medium text-foreground">{c.full_name ?? "Sem nome"}</td>
                        <td className="px-4 py-3 tabular-nums">{c.due_on.split("-").reverse().join("/")}</td>
                        <td className="px-4 py-3 tabular-nums">{formatBRL(c.amount_cents)}</td>
                        <td className="px-4 py-3"><Badge tone={tone(c)}>{statusText(c)}</Badge></td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            {c.status === "pending" ? (
                              <>
                                <Button size="sm" disabled={busy} onClick={() => pay.mutate(c.charge_id)} aria-label={`Marcar ${c.full_name ?? "paciente"} como pago`}>Marcar pago</Button>
                                <Button size="sm" variant="outline" disabled={busy} onClick={() => cancel.mutate(c.charge_id)} aria-label={`Cancelar cobrança de ${c.full_name ?? "paciente"}`}>Cancelar</Button>
                              </>
                            ) : (
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => reopen.mutate(c.charge_id)} aria-label={`Reabrir cobrança de ${c.full_name ?? "paciente"}`}>Reabrir</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Projeção dos próximos meses</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex h-32 items-end gap-4" role="img" aria-label="Projeção de receita dos próximos 3 meses">
                  {o.projection.map((p) => (
                    <div key={p.month} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-xs tabular-nums text-muted-foreground">{formatBRL(p.expected_cents)}</span>
                      <div className="w-full rounded-t bg-primary" style={{ height: `${Math.max(4, Math.round((p.expected_cents / projMax) * 80))}px` }} data-testid="proj-bar" />
                      <span className="text-xs text-muted-foreground">{monthShort(p.month)}</span>
                    </div>
                  ))}
                </div>
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Ticket médio</dt><dd className="font-medium tabular-nums">{o.ticket_avg_cents == null ? "—" : formatBRL(o.ticket_avg_cents)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Permanência média</dt><dd className="font-medium tabular-nums">{o.tenure_avg_months == null ? "—" : `${String(o.tenure_avg_months).replace(".", ",")} meses`}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Valor por paciente (estimado)</dt><dd className="font-medium tabular-nums">{o.ticket_avg_cents == null || o.tenure_avg_months == null ? "—" : formatBRL(Math.round(o.ticket_avg_cents * o.tenure_avg_months))}</dd></div>
                </dl>
                <p className="text-xs text-muted-foreground">Projeção = mensalidades ativas de hoje repetidas; não considera entradas nem saídas futuras. O valor por paciente é uma estimativa (ticket médio × permanência média).</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Valores por paciente</CardTitle></CardHeader>
              <CardContent>
                {o.unconfigured_patients > 0 ? <p className="mb-3 text-xs text-muted-foreground">{o.unconfigured_patients === 1 ? "1 paciente ainda não tem" : `${o.unconfigured_patients} pacientes ainda não têm`} valor definido.</p> : null}
                {patients.isLoading ? <Skeleton className="h-24 w-full" /> : (patients.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nenhum paciente ativo.</p> : (
                  <ul className="max-h-80 space-y-2 overflow-auto">
                    {(patients.data ?? []).map((p) => (
                      <li key={p.patient_id} className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{p.full_name ?? "Sem nome"}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.monthly_amount_cents == null ? "Sem valor definido" : `${formatBRL(p.monthly_amount_cents)} · vence dia ${p.due_day}${p.is_active ? "" : " · cobrança desligada"}`}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setEditing(p)} aria-label={`${p.monthly_amount_cents == null ? "Definir" : "Editar"} valor de ${p.full_name ?? "paciente"}`}>
                          {p.monthly_amount_cents == null ? "Definir valor" : "Editar"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
          <p className="text-xs text-muted-foreground">Controle manual: o sistema não cobra o paciente nem envia lembrete de pagamento. Os valores ficam só nesta tela e são vistos apenas pelo administrador.</p>
        </>
      )}
      <BillingDialog patient={editing} open={editing !== null} onOpenChange={(o2) => !o2 && setEditing(null)} />
    </div>
  );
}
