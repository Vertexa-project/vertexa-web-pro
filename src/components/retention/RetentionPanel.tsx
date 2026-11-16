import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { AttentionRow } from "@/components/dashboard/AttentionRow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPercent, professionalTypeLabel } from "@/lib/domain/format";
import { classifyPatient, focusAction, focusOrder, type AttentionReason } from "@/lib/domain/attention";
import { computePendencies } from "@/lib/domain/pendencies";
import { cn } from "@/lib/utils";
import type { PatientListItem } from "@/types/db";

// Cor da barra pela faixa de adesão (coerente com os cards de status, não pelo laranja-marca).
function adherenceBarColor(rate: number): string {
  if (rate >= 80) return "bg-success";
  if (rate >= 50) return "bg-warning";
  return "bg-destructive";
}

/** Motivo de registro (não o de adesão) que move a ação da lista de pendências. */
function pendencyReason(p: PatientListItem): AttentionReason | null {
  const { reasons, primary } = classifyPatient(p);
  return reasons.find((r) => r.kind !== "adherence_drop") ?? primary;
}

/**
 * Painel de retenção reutilizável (coortes). Vive no Dashboard (centro do produto) e
 * também na rota /retencao (deep-link). Recebe a lista de pacientes já carregada e um
 * callback de navegação (ação por motivo: lib/domain/attention.focusAction) — não busca dados por conta própria (DRY com quem o renderiza).
 */
export function RetentionPanel({
  patients,
  onNavigate,
}: {
  patients: PatientListItem[];
  onNavigate: (to: string) => void;
}) {
  const view = useMemo(() => {
    // Mesma regra dos KPIs do Dashboard (lib/domain/attention).
    const reactivate = focusOrder(patients);

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
              view.reactivate.map(({ patient: p, attention }) => (
                <AttentionRow
                  key={p.id}
                  name={p.profile?.full_name ?? "Sem nome"}
                  action={focusAction(p.id, attention.primary)}
                  onAction={onNavigate}
                  badges={attention.reasons.map((r) => (
                    <Badge key={r.kind} className="whitespace-normal" tone={attention.level === "em_risco" ? "destructive" : "warning"}>
                      {r.label}
                    </Badge>
                  ))}
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
                <AttentionRow
                  key={patient.id}
                  name={patient.profile?.full_name ?? "Sem nome"}
                  action={focusAction(patient.id, pendencyReason(patient))}
                  onAction={onNavigate}
                  badges={pend.labels.map((l) => (
                    <span key={l} className="rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning-foreground dark:text-warning">
                      {l}
                    </span>
                  ))}
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
