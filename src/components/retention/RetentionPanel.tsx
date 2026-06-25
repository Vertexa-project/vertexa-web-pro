import { useMemo } from "react";

import { StatusBadge } from "@/components/status/StatusBadge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPercent, initials, professionalTypeLabel } from "@/lib/domain/format";
import { computePendencies } from "@/lib/domain/pendencies";
import { cn } from "@/lib/utils";
import type { PatientListItem } from "@/types/db";

// Cor da barra pela faixa de adesão (coerente com os cards de status, não pelo laranja-marca).
function adherenceBarColor(rate: number): string {
  if (rate >= 80) return "bg-success";
  if (rate >= 50) return "bg-warning";
  return "bg-destructive";
}

function PatientRow({
  patient,
  onClick,
  trailing,
}: {
  patient: PatientListItem;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  const name = patient.profile?.full_name ?? "Sem nome";
  return (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{name}</p>
        <div className="mt-1">{trailing}</div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={`Tratar ${name}`}
        onClick={onClick}
      >
        Tratar
      </Button>
    </div>
  );
}

/**
 * Painel de retenção reutilizável (coortes). Vive no Dashboard (centro do produto) e
 * também na rota /retencao (deep-link). Recebe a lista de pacientes já carregada e um
 * callback de navegação — não busca dados por conta própria (DRY com quem o renderiza).
 */
export function RetentionPanel({
  patients,
  onPatientClick,
}: {
  patients: PatientListItem[];
  onPatientClick: (patientId: string) => void;
}) {
  const view = useMemo(() => {
    const reactivate = patients
      .filter((p) => p.snapshot?.status === "em_risco" || p.snapshot?.status === "atencao")
      .sort((a, b) => (a.snapshot?.score ?? 0) - (b.snapshot?.score ?? 0));

    const pendentes = patients
      .map((p) => ({
        patient: p,
        pend: computePendencies({
          lastWeightAt: p.lastWeightAt,
          lastPhotoAt: p.lastPhotoAt,
          lastWorkoutAt: p.lastWorkoutAt,
        }),
      }))
      .filter((x) => x.pend.count > 0)
      .sort((a, b) => b.pend.count - a.pend.count);

    const byProf = new Map<string, { id: string; name: string; type: string; total: number; sum: number }>();
    patients.forEach((p) => {
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
    const professionals = [...byProf.values()].map((p) => ({ ...p, avg: p.total ? Math.round(p.sum / p.total) : 0 }));

    return { reactivate, pendentes, professionals };
  }, [patients]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Para reativar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {view.reactivate.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguém em risco ou atenção no momento.</p>
            ) : (
              view.reactivate.map((p) => (
                <PatientRow
                  key={p.id}
                  patient={p}
                  onClick={() => onPatientClick(p.id)}
                  trailing={<StatusBadge status={p.snapshot?.status} score={p.snapshot?.score} />}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pendências de registro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {view.pendentes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todos com peso, foto e treino em dia.
              </p>
            ) : (
              view.pendentes.map(({ patient, pend }) => (
                <PatientRow
                  key={patient.id}
                  patient={patient}
                  onClick={() => onPatientClick(patient.id)}
                  trailing={
                    <div className="flex flex-wrap gap-1">
                      {pend.labels.map((l) => (
                        <span
                          key={l}
                          className="rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning-foreground"
                        >
                          {l}
                        </span>
                      ))}
                    </div>
                  }
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

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
                  <div className={cn("h-full rounded-full", adherenceBarColor(pr.avg))} style={{ width: `${pr.avg}%` }} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
