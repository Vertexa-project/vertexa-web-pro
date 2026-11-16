import { useContext, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, AlertTriangle, ArrowRight, ClipboardList, Gauge, Sparkles, TrendingUp, Users } from "lucide-react";

import { AdherenceChart } from "@/components/dashboard/AdherenceChart";
import { AttentionRow } from "@/components/dashboard/AttentionRow";
import { TodayAgenda } from "@/components/dashboard/TodayAgenda";
import { ScreenSuggestions } from "@/components/vertexa-ai/ScreenSuggestions";
import { VertexaAiContext } from "@/components/vertexa-ai/vertexa-ai-context";
import { StatCard } from "@/components/dashboard/StatCard";
import { RetentionPanel } from "@/components/retention/RetentionPanel";
import { ErrorState } from "@/components/feedback/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentProfessional, useCurrentProfessionalName } from "@/hooks/useCurrentProfessional";
import { useListPatients } from "@/hooks/usePatients";
import { greeting, shortName } from "@/lib/domain/format";
import { hojeSubtitle, weekdayDateBR } from "@/lib/domain/hoje";
import { hourBR } from "@/lib/domain/vertexaAi";
import { attentionKpis, focusAction, focusOrder, type PatientAttention } from "@/lib/domain/attention";
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

function FocusItem({ patient, attention }: { patient: PatientListItem; attention: PatientAttention }) {
  const navigate = useNavigate();
  return (
    <AttentionRow
      name={patient.profile?.full_name ?? "Sem nome"}
      badges={attention.reasons.map((r) => (
        <Badge key={r.kind} className="whitespace-normal" tone={attention.level === "em_risco" ? "destructive" : "warning"}>
          {r.label}
        </Badge>
      ))}
      action={focusAction(patient.id, attention.primary)}
      onAction={navigate}
    />
  );
}

export function DashboardPage() {
  const now = new Date();
  const ai = useContext(VertexaAiContext);
  const [agendaCount, setAgendaCount] = useState<number | null>(null);
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useListPatients();
  const { data: professionalName } = useCurrentProfessionalName();
  const { data: professional } = useCurrentProfessional();
  const who = shortName(professionalName);

  const stats = useMemo(() => {
    const list = data ?? [];
    const { emRisco, atencao, pendencias } = attentionKpis(list);
    const rates = list.map((p) => p.snapshot?.weekly_completion_rate ?? 0);
    const adesaoMedia = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0;
    // KPIs e "Foco do dia" leem da MESMA regra (lib/domain/attention).
    const foco = focusOrder(list).slice(0, 5);
    return { total: list.length, emRisco, atencao, adesaoMedia, pendencias, foco };
  }, [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={who ? `${greeting(hourBR(now))}, ${who}` : greeting(hourBR(now))}
        description={hojeSubtitle(weekdayDateBR(now), agendaCount, isLoading || isError ? null : stats.emRisco + stats.atencao)}
        actions={
          ai ? (
            <Button variant="outline" onClick={() => ai.openWith("Quem precisa de mim hoje?")}>
              <Sparkles className="h-4 w-4 text-brand" aria-hidden />
              Preparar meu dia
            </Button>
          ) : null
        }
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
            <Card className="flex flex-col lg:col-span-2">
              <CardHeader>
                <CardTitle>Foco do dia</CardTitle>
                <p className="text-sm text-muted-foreground">Quem precisa de você e qual a próxima ação.</p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col space-y-4">
                {stats.foco.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem pacientes para priorizar.</p>
                ) : (
                  stats.foco.map((f) => <FocusItem key={f.patient.id} patient={f.patient} attention={f.attention} />)
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


            <TodayAgenda
              clinicId={professional?.clinicId ?? null}
              professionalId={professional?.id ?? null}
              onCount={setAgendaCount}
            />
          </div>

          {ai ? (
            <Card>
              <CardHeader className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand" aria-hidden />
                  Vertexa IA sugere
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Tudo vira rascunho para você revisar. Nada é enviado nem salvo sem a sua confirmação.
                </p>
              </CardHeader>
              <CardContent>
                <ScreenSuggestions screen={ai.screen} onPick={(t) => ai.openWith(t)} />
              </CardContent>
            </Card>
          ) : null}

          {/* Retenção vive no Dashboard (centro do produto): coortes p/ reativar,
              pendências de registro e adesão por profissional. Mesmo painel da rota
              /retencao (deep-link), agora sem item de menu lateral. */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Retenção &amp; coortes</h2>
            <RetentionPanel patients={data ?? []} onNavigate={navigate} />
          </section>

          <Card>
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
        </>
      )}
    </div>
  );
}
