// Ficha do paciente (Resumo): cartão "Rotina" e cartão "Missão da 1ª semana" (A4 + A5).
import { useState } from "react";
import { CheckCircle2, ClipboardCheck, Circle, Loader2, Rocket } from "lucide-react";

import { RoutineOverrideDialog } from "./RoutineOverrideDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePatientMission, usePatientRoutine, useStartMission } from "@/hooks/useRoutine";
import { dayMonth, doneOfTotal, periodText, SOURCE_LABEL, STATE_LABEL, type RoutineOccurrence } from "@/lib/domain/routine";

const CHIP: Record<RoutineOccurrence["state"], string> = {
  done: "bg-success/15 text-success", due_today: "bg-primary/15 text-primary-ink", overdue: "bg-destructive/15 text-destructive", missed: "bg-muted text-muted-foreground",
};

export function RoutineCard({ patientId, patientName }: { patientId: string; patientName: string }) {
  const q = usePatientRoutine(patientId);
  const [open, setOpen] = useState(false);
  const v = q.data;
  return (
    <Card data-testid="routine-card">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4 text-muted-foreground" aria-hidden />Rotina</CardTitle>
        {v && v.source !== "clinic_off" ? <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Ajustar rotina deste paciente</Button> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? <Skeleton className="h-12 w-full" /> : q.isError || !v ? (
          <p className="text-sm text-muted-foreground">Não foi possível carregar. <button type="button" className="underline" onClick={() => q.refetch()}>Tentar de novo</button></p>
        ) : v.source === "clinic_off" ? (
          <p className="text-sm text-muted-foreground">A rotina está desligada na clínica. Para ligar: Configurações → Rotina do paciente.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={v.enabled ? (v.source === "custom" ? "warning" : "success") : "muted"}>{SOURCE_LABEL[v.source]}</Badge>
              {v.current.length > 0 ? <Badge tone="destructive">{v.current.length === 1 ? "1 pendente" : `${v.current.length} pendentes`}</Badge> : v.enabled ? <Badge tone="success">Em dia</Badge> : null}
            </div>
            {v.enabled ? (
              <ul className="divide-y">
                {v.items.map((it) => {
                  const { done, total } = doneOfTotal(it);
                  const cur = v.current.find((c) => c.key === it.key);
                  return (
                    <li key={it.key} className="space-y-1.5 py-2.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="break-words text-sm font-medium text-foreground">{it.label}</p>
                        <p className="text-xs text-muted-foreground">{periodText(it.period, it.weekday)} · {done} de {total} cumpridas</p>
                      </div>
                      {cur ? <p className="text-xs font-medium text-destructive">{cur.state === "due_today" ? "Para hoje, ainda não feito." : `Pendente desde ${dayMonth(cur.due_on)}.`}</p> : null}
                      <div className="flex flex-wrap gap-1.5">
                        {it.occurrences.map((o) => (
                          <span key={o.date} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CHIP[o.state]}`}>
                            {dayMonth(o.date)} · {STATE_LABEL[o.state]}{o.state === "done" && o.done_on && o.done_on !== o.date ? ` em ${dayMonth(o.done_on)}` : ""}
                          </span>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Este paciente não recebe os cartões da rotina.</p>}
            {v.last_feedback ? (
              <figure className="rounded-md border border-border bg-muted/40 p-3">
                <figcaption className="text-xs text-muted-foreground">Último feedback do paciente</figcaption>
                <blockquote className="mt-1 break-words text-sm text-foreground">“{v.last_feedback.note}”</blockquote>
              </figure>
            ) : null}
          </>
        )}
      </CardContent>
      <RoutineOverrideDialog open={open} onOpenChange={setOpen} patientId={patientId} patientName={patientName} view={v} />
    </Card>
  );
}

export function MissionCard({ patientId }: { patientId: string }) {
  const q = usePatientMission(patientId);
  const start = useStartMission(patientId);
  const [error, setError] = useState<string | null>(null);
  const m = q.data;
  if (q.isLoading) return <Card><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>;
  if (q.isError || !m) return null;
  if (!m.enabled) return null;
  const run = (restart: boolean) => {
    setError(null);
    if (restart && !window.confirm("Reiniciar a missão deste paciente? O progresso volta a zero e conta só os registros a partir de hoje.")) return;
    start.mutate(restart, { onError: () => setError("Não foi possível iniciar. Tente de novo.") });
  };
  const total = m.total ?? 0;
  const done = m.done_count ?? 0;
  return (
    <Card data-testid="mission-card">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base"><Rocket className="h-4 w-4 text-muted-foreground" aria-hidden />Missão da 1ª semana</CardTitle>
        {m.started ? <Button size="sm" variant="ghost" onClick={() => run(true)} disabled={start.isPending}>Reiniciar missão</Button> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {!m.started ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Este paciente ainda não começou a missão. Ao iniciar, o app mostra o checklist e conta os registros feitos a partir de hoje.</p>
            <Button size="sm" onClick={() => run(false)} disabled={start.isPending}>
              {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Iniciar missão da 1ª semana
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">Missão da 1ª semana: {done} de {total}</p>
              {m.completed ? <Badge tone="success">Concluída em {dayMonth(m.completed_on)}</Badge> : m.overdue ? <Badge tone="destructive">Atrasada · prazo {dayMonth(m.ends_on)}</Badge> : <Badge tone="muted">Prazo {dayMonth(m.ends_on)}</Badge>}
              {m.completed ? <Badge tone="success">Pronto para a consulta</Badge> : null}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Progresso da missão">
              <div className="h-full rounded-full bg-primary" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
            </div>
            <ul className="divide-y">
              {(m.steps ?? []).map((s) => (
                <li key={s.key} className="flex items-start gap-2 py-2">
                  {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                  <p className={`min-w-0 flex-1 break-words text-sm ${s.done ? "text-muted-foreground" : "text-foreground"}`}>{s.label}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">{s.done ? `feito ${dayMonth(s.done_on)}` : "pendente"}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
