import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, AlertTriangle, CalendarOff, Gauge } from "lucide-react";

import { RetentionPanel } from "@/components/retention/RetentionPanel";
import { StatCard } from "@/components/dashboard/StatCard";
import { ErrorState } from "@/components/feedback/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useListPatients } from "@/hooks/usePatients";

const DAY = 1000 * 60 * 60 * 24;

function isStale(lastActivityAt: string | null): boolean {
  if (!lastActivityAt) return true;
  return Date.now() - new Date(lastActivityAt).getTime() > 7 * DAY;
}

// Rota mantida para deep-link; saiu do menu lateral (as coortes vivem no Dashboard).
export function RetentionPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useListPatients();

  const stats = useMemo(() => {
    const list = data ?? [];
    const ativos = list.filter((p) => p.snapshot?.status !== "inativo").length;
    const emRisco = list.filter((p) => p.snapshot?.status === "em_risco").length;
    const stale = list.filter((p) => isStale(p.lastActivityAt)).length;
    const rates = list.map((p) => p.snapshot?.weekly_completion_rate ?? 0);
    const adesaoMedia = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0;
    return { ativos, emRisco, stale, adesaoMedia };
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
            <StatCard icon={Activity} label="Pacientes ativos" value={stats.ativos} tone="primary" />
            <StatCard icon={AlertTriangle} label="Em risco" value={stats.emRisco} tone="destructive" />
            <StatCard icon={CalendarOff} label="Sem atividade (7d)" value={stats.stale} tone="warning" />
            <StatCard icon={Gauge} label="Adesão média" value={`${stats.adesaoMedia}%`} tone="success" />
          </div>

          <RetentionPanel patients={data ?? []} onPatientClick={(id) => navigate(`/pacientes/${id}`)} />
        </>
      )}
    </div>
  );
}
