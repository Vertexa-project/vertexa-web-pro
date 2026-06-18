import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, AlertTriangle, CalendarOff, Gauge } from "lucide-react";

import { StatCard } from "@/components/dashboard/StatCard";
import { ErrorState } from "@/components/feedback/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/status/StatusBadge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useListPatients } from "@/hooks/usePatients";
import { formatPercent, initials, professionalTypeLabel } from "@/lib/domain/format";
import { cn } from "@/lib/utils";
import type { PatientListItem } from "@/types/db";

const DAY = 1000 * 60 * 60 * 24;

function isStale(lastActivityAt: string | null): boolean {
  if (!lastActivityAt) return true;
  return Date.now() - new Date(lastActivityAt).getTime() > 7 * DAY;
}

// Cor da barra pela faixa de adesão (coerente com os cards de status), não pelo laranja-marca.
function adherenceBarColor(rate: number): string {
  if (rate >= 80) return "bg-success";
  if (rate >= 50) return "bg-warning";
  return "bg-destructive";
}

export function RetentionPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useListPatients();

  const view = useMemo(() => {
    const list = data ?? [];
    const ativos = list.filter((p) => p.snapshot?.status !== "inativo").length;
    const emRisco = list.filter((p) => p.snapshot?.status === "em_risco").length;
    const stale = list.filter((p) => isStale(p.lastActivityAt)).length;
    const rates = list.map((p) => p.snapshot?.weekly_completion_rate ?? 0);
    const adesaoMedia = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0;

    const reactivate = list
      .filter((p) => p.snapshot?.status === "em_risco" || p.snapshot?.status === "atencao")
      .sort((a, b) => (a.snapshot?.score ?? 0) - (b.snapshot?.score ?? 0));

    const byProf = new Map<
      string,
      { id: string; name: string; type: string; total: number; sum: number }
    >();
    list.forEach((p) => {
      const rate = p.snapshot?.weekly_completion_rate ?? 0;
      p.professionals.forEach((pr) => {
        const cur = byProf.get(pr.id) ?? {
          id: pr.id,
          name: pr.full_name ?? "Profissional",
          type: professionalTypeLabel(pr.type),
          total: 0,
          sum: 0,
        };
        cur.total += 1;
        cur.sum += rate;
        byProf.set(pr.id, cur);
      });
    });
    const professionals = [...byProf.values()].map((p) => ({
      ...p,
      avg: p.total ? Math.round(p.sum / p.total) : 0,
    }));

    return { total: list.length, ativos, emRisco, stale, adesaoMedia, reactivate, professionals };
  }, [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Retenção"
        description="Quem está engajado, quem está em risco e quem precisa de reativação."
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Activity} label="Pacientes ativos" value={view.ativos} tone="primary" />
            <StatCard icon={AlertTriangle} label="Em risco" value={view.emRisco} tone="destructive" />
            <StatCard icon={CalendarOff} label="Sem atividade (7d)" value={view.stale} tone="warning" />
            <StatCard icon={Gauge} label="Adesão média" value={`${view.adesaoMedia}%`} tone="success" />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Para reativar</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {view.reactivate.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ninguém em risco ou atenção no momento.</p>
                ) : (
                  view.reactivate.map((p: PatientListItem) => {
                    const name = p.profile?.full_name ?? "Sem nome";
                    return (
                      <div key={p.id} className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback>{initials(name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-foreground">{name}</p>
                          <div className="mt-1">
                            <StatusBadge status={p.snapshot?.status} score={p.snapshot?.score} />
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          aria-label={`Tratar ${name}`}
                          onClick={() => navigate(`/pacientes/${p.id}`)}
                        >
                          Tratar
                        </Button>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Adesão por profissional</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {view.professionals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem profissionais vinculados.</p>
                ) : (
                  view.professionals.map((pr) => (
                    <div key={pr.id} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-foreground">{pr.name}</span>
                        <span className="text-muted-foreground">
                          {formatPercent(pr.avg)} · {pr.total} {pr.total === 1 ? "paciente" : "pacientes"}
                        </span>
                      </div>
                      <div
                        className="h-2 w-full overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuenow={pr.avg}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Adesão de ${pr.name}`}
                      >
                        <div
                          className={cn("h-full rounded-full", adherenceBarColor(pr.avg))}
                          style={{ width: `${pr.avg}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
