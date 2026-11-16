// Exames e retornos do paciente (A2, redesign P6). Cada linha é UM lembrete; data nova muda a linha; apagar remove.
import { useState } from "react";
import { CalendarClock, Check, FlaskConical, Pencil, Plus, Trash2, Undo2 } from "lucide-react";

import { ReminderDialog } from "./ReminderDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompleteReminder, useDeleteReminder, usePatientReminders } from "@/hooks/usePatientReminders";
import { daysUntil, isoDateBRText, reminderHeadline, whenText, type ReminderKind, type ReminderRow } from "@/lib/domain/patientReminders";
import { todayIsoBR } from "@/lib/domain/stockMoves";

export function RemindersCard({ patientId, patientName }: { patientId: string; patientName: string }) {
  const { data, isLoading, isError, refetch } = usePatientReminders(patientId);
  const complete = useCompleteReminder(patientId);
  const remove = useDeleteReminder(patientId);
  const [dialog, setDialog] = useState<{ kind: ReminderKind; existing: ReminderRow | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = todayIsoBR();

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().catch(() => setError("Não foi possível concluir. Tente novamente."));
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
          Exames e retornos
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "return", existing: (data ?? []).find((r) => r.kind === "return" && !r.done_at) ?? null })}>
            <Plus className="h-4 w-4" aria-hidden />
            Retorno
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "exam", existing: null })}>
            <Plus className="h-4 w-4" aria-hidden />
            Exame
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar.{" "}
            <button type="button" className="underline" onClick={() => refetch()}>Tentar de novo</button>
          </p>
        ) : (data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum retorno ou exame cadastrado. Ao cadastrar, o paciente é avisado no app e você vê no Hoje.
          </p>
        ) : (
          <ul className="divide-y">
            {(data ?? []).map((r) => {
              const days = daysUntil(r.due_on, today);
              const overdue = !r.done_at && days < 0;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    {r.kind === "return" ? <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <FlaskConical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <div className="min-w-0">
                      <p className={`break-words text-sm font-medium ${r.done_at ? "text-muted-foreground line-through" : "text-foreground"}`}>{reminderHeadline(r)}</p>
                      <p className="text-xs text-muted-foreground">
                        {isoDateBRText(r.due_on)}
                        {r.done_at ? " · feito" : ` · ${whenText(days)}`}
                        {!r.notify_patient ? " · sem aviso ao paciente" : ""}
                      </p>
                    </div>
                    {overdue ? <Badge tone="destructive">Atrasado</Badge> : null}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {!r.done_at ? (
                      <Button size="sm" variant="ghost" aria-label={`Editar ${reminderHeadline(r)}`} onClick={() => setDialog({ kind: r.kind, existing: r })}>
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={r.done_at ? `Reabrir ${reminderHeadline(r)}` : `Marcar como feito: ${reminderHeadline(r)}`}
                      disabled={complete.isPending}
                      onClick={() => run(() => complete.mutateAsync({ id: r.id, done: !r.done_at }))}
                    >
                      {r.done_at ? <Undo2 className="h-4 w-4" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={`Apagar ${reminderHeadline(r)}`} disabled={remove.isPending} onClick={() => run(() => remove.mutateAsync(r.id))}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </CardContent>
      {dialog ? (
        <ReminderDialog open onOpenChange={(o) => { if (!o) setDialog(null); }} patientId={patientId} patientName={patientName} kind={dialog.kind} existing={dialog.existing} />
      ) : null}
    </Card>
  );
}
