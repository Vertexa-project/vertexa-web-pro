import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, AlertTriangle, ArrowRight, ClipboardList, Gauge, TrendingUp, Users } from "lucide-react";

import { AdherenceChart } from "@/components/dashboard/AdherenceChart";
import { StatCard } from "@/components/dashboard/StatCard";
import { RetentionPanel } from "@/components/retention/RetentionPanel";
import { ErrorState } from "@/components/feedback/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/status/StatusBadge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentProfessionalName } from "@/hooks/useCurrentProfessional";
import { useListPatients } from "@/hooks/usePatients";
import { formatDate, greeting, initials, shortName } from "@/lib/domain/format";
import { hasPendency } from "@/lib/domain/pendencies";
import type { PatientListItem } from "@/types/db";

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 w-full lg:col-span-1" />
        <Skeleton className="h-72 w-full lg:col-span-2" />
      </div>
    </div>
  );
}

function FocusItem({ patient }: { patient: PatientListItem }) {
  const navigate = useNavigate();
  const name = patient.profile?.full_name ?? "Sem nome";
  return (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{name}</p>
        <div className="mt-1">
          <StatusBadge status={patient.snapshot?.status} score={patient.snapshot?.score} />
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => navigate(`/pacientes/${patient.id}`)}
      >
        Tratar
      </Button>
    </div>
  );
}

export function DashboardPage() {
  const now = new Date();
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useListPatients();
  const { data: professionalName } = useCurrentProfessionalName();
  const who = shortName(professionalName);

  const stats = useMemo(() => {
    const list = data ?? [];
    const emRisco = list.filter((p) => p.snapshot?.status === "em_risco").length;
    const atencao = list.filter((p) => p.snapshot?.status === "atencao").length;
    const rates = list.map((p) => p.snapshot?.weekly_completion_rate ?? 0);
    const adesaoMedia = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0;
    // Pendências = pacientes sem peso/foto/treino recente (regra pura compartilhada).
    const pendencias = list.filter((p) =>
      hasPendency({ lastWeightAt: p.lastWeightAt, lastPhotoAt: p.lastPhotoAt, lastWorkoutAt: p.lastWorkoutAt }),
    ).length;
    const foco = [...list]
      .sort((a, b) => (a.snapshot?.score ?? 0) - (b.snapshot?.score ?? 0))
      .slice(0, 3);
    return { total: list.length, emRisco, atencao, adesaoMedia, pendencias, foco };
  }, [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={who ? `${greeting(now.getHours())}, ${who}!` : `${greeting(now.getHours())}!`}
        description={formatDate(now)}
      />

      {isLoading ? (
        <DashboardSkeleton />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <StatCard icon={Users} label="Pacientes ativos" value={stats.total} tone="primary" />
            <StatCard icon={AlertTriangle} label="Em risco" value={stats.emRisco} tone="destructive" />
            <StatCard icon={Activity} label="Em atenção" value={stats.atencao} tone="warning" />
            <StatCard
              icon={Gauge}
              label="Adesão média"
              value={`${stats.adesaoMedia}%`}
              tone="success"
            />
            <StatCard
              icon={ClipboardList}
              label="Com pendências"
              value={stats.pendencias}
              hint="Sem peso, foto ou treino recente"
              tone="warning"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="flex flex-col lg:col-span-1">
              <CardHeader>
                <CardTitle>Foco do dia</CardTitle>
                <p className="text-sm text-muted-foreground">Quem mais precisa de você agora.</p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col space-y-4">
                {stats.foco.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem pacientes para priorizar.</p>
                ) : (
                  stats.foco.map((p) => <FocusItem key={p.id} patient={p} />)
                )}
                <Button
                  variant="ghost"
                  className="mt-auto w-full justify-center text-muted-foreground hover:text-foreground"
                  onClick={() => navigate("/pacientes")}
                >
                  Ver todos os pacientes
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Adesão semanal por paciente</CardTitle>
                <TrendingUp className="h-5 w-5 text-muted-foreground" aria-hidden />
              </CardHeader>
              <CardContent>
                {data && data.length > 0 ? (
                  <AdherenceChart patients={data} />
                ) : (
                  <p className="py-12 text-center text-sm text-muted-foreground">Sem dados de adesão.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Retenção vive no Dashboard (centro do produto): coortes p/ reativar,
              pendências de registro e adesão por profissional. Mesmo painel da rota
              /retencao (deep-link), agora sem item de menu lateral. */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Retenção &amp; coortes</h2>
            <RetentionPanel patients={data ?? []} onPatientClick={(patientId) => navigate(`/pacientes/${patientId}`)} />
          </section>
        </>
      )}
    </div>
  );
}
