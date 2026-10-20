import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRightLeft, UserMinus, Users, UserX } from "lucide-react";

import { StatCard } from "@/components/dashboard/StatCard";
import { ErrorState } from "@/components/feedback/ErrorState";
import { TransferDialog } from "@/components/management/TransferDialog";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useClinicBrand } from "@/hooks/useClinicBrand";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import { useManagementOverview } from "@/hooks/useManagement";
import { idleLabel, loadShare, maxLoad, monthLabel } from "@/lib/domain/management";

const IDLE_OPTIONS = [7, 14, 30] as const;

export function ManagementPage() {
  const brand = useClinicBrand();
  const clinicId = brand.data?.clinicId ?? null;
  const { isClinicAdmin, isLoading: adminLoading } = useIsClinicAdmin(clinicId);
  const [idle, setIdle] = useState<number>(7);
  const [transferFrom, setTransferFrom] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const overview = useManagementOverview(isClinicAdmin ? clinicId : null, idle);
  const o = overview.data;

  if (!adminLoading && !isClinicAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Gestão" description="Visão da clínica." />
        <p className="text-sm text-muted-foreground" role="note">Esta área é só para o administrador da clínica.</p>
      </div>
    );
  }

  const max = o ? maxLoad(o.professionals) : 0;
  const monthMax = o ? Math.max(1, ...o.new_by_month.map((m) => m.n)) : 1;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Gestão"
        description="Como está a carteira de cada profissional, quem entrou e quem parou de usar."
        actions={o && o.professionals.length > 1 ? (
          <Button onClick={() => { setTransferFrom(null); setTransferOpen(true); }}>
            <ArrowRightLeft className="h-4 w-4" />
            Transferir pacientes
          </Button>
        ) : null}
      />

      {overview.isLoading || adminLoading ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : overview.isError || !o ? (
        <ErrorState onRetry={() => overview.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard icon={Users} label="Pacientes" value={o.patients} tone="primary" />
            <StatCard icon={Users} label="Profissionais ativos" value={o.professionals.length} tone="success" />
            <StatCard icon={UserMinus} label="Sem profissional" value={o.unassigned} tone={o.unassigned > 0 ? "warning" : "success"} />
            <StatCard icon={UserX} label={`Parados há ${o.idle_days}+ dias`} value={o.stopped.length >= 20 ? "20+" : o.stopped.length} tone={o.stopped.length > 0 ? "destructive" : "success"} />
          </div>

          <section aria-label="Carteira por profissional" className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">Carteira por profissional</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Profissional</th>
                    <th className="px-4 py-2 font-medium">Pacientes</th>
                    <th className="px-4 py-2 font-medium">Em risco</th>
                    <th className="px-4 py-2 font-medium">Atenção</th>
                    <th className="px-4 py-2 font-medium">Adesão média</th>
                    <th className="px-4 py-2 font-medium">Parados</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {o.professionals.map((p) => (
                    <tr key={p.professional_id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium text-foreground">{p.name}{p.clinic_role === "admin" ? <span className="ml-2 text-xs font-normal text-muted-foreground">admin</span> : null}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-6 tabular-nums">{p.patients}</span>
                          <div className="h-2 w-24 rounded-full bg-muted" aria-hidden><div className="h-2 rounded-full bg-primary" style={{ width: `${loadShare(p.patients, max)}%` }} /></div>
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{p.em_risco}</td>
                      <td className="px-4 py-3 tabular-nums">{p.atencao}</td>
                      <td className="px-4 py-3 tabular-nums">{p.avg_adherence === null ? "—" : `${p.avg_adherence}%`}</td>
                      <td className="px-4 py-3 tabular-nums">{p.idle}</td>
                      <td className="px-4 py-3 text-right">
                        {o.professionals.length > 1 && p.patients > 0 ? (
                          <Button variant="outline" size="sm" onClick={() => { setTransferFrom(p.professional_id); setTransferOpen(true); }} aria-label={`Transferir pacientes de ${p.name}`}>
                            <ArrowRightLeft className="h-4 w-4" />
                            Transferir
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {o.unassigned > 0 ? <p className="text-xs text-muted-foreground">{o.unassigned === 1 ? "1 paciente está" : `${o.unassigned} pacientes estão`} sem profissional. Atribua pela ficha do paciente.</p> : null}
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Novos pacientes por mês</CardTitle></CardHeader>
              <CardContent>
                <div className="flex h-40 items-end gap-3" role="img" aria-label="Novos pacientes nos últimos 6 meses">
                  {o.new_by_month.map((m) => (
                    <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-xs tabular-nums text-muted-foreground">{m.n}</span>
                      <div className="w-full rounded-t bg-primary" style={{ height: `${Math.max(4, Math.round((m.n / monthMax) * 100))}%` }} />
                      <span className="text-xs text-muted-foreground">{monthLabel(m.month)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Quem parou de usar</CardTitle>
                <div className="flex gap-1" role="group" aria-label="Dias sem registrar">
                  {IDLE_OPTIONS.map((d) => (
                    <Button key={d} size="sm" variant={idle === d ? "default" : "outline"} aria-pressed={idle === d} onClick={() => setIdle(d)}>{d}+ dias</Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                {o.stopped.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ninguém está parado há {o.idle_days} dias ou mais.</p>
                ) : (
                  <ul className="space-y-3">
                    {o.stopped.map((s) => (
                      <li key={s.patient_id} className="flex items-center gap-3">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <Link to={`/pacientes/${s.patient_id}`} className="truncate font-medium text-foreground hover:underline">{s.name ?? "Sem nome"}</Link>
                          <p className="text-xs text-muted-foreground">{s.professionals.length ? s.professionals.join(", ") : "Sem profissional"}</p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">{idleLabel(s.idle_days)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {clinicId && o ? <TransferDialog clinicId={clinicId} professionals={o.professionals} fromId={transferFrom} open={transferOpen} onOpenChange={setTransferOpen} /> : null}
    </div>
  );
}
