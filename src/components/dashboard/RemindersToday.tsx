// Exames e retornos no Hoje do profissional (A2, redesign P6): lembretes que entraram na janela de aviso da equipe.
// Derivado na leitura (sem cron), com a data de Brasília. Mudou a data no cadastro, muda aqui.
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpenReminders } from "@/hooks/usePatientReminders";
import { isoDateBRText, proReminderLines } from "@/lib/domain/patientReminders";
import { todayIsoBR } from "@/lib/domain/stockMoves";

const MAX_LINES = 8;

export function RemindersToday({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useOpenReminders(enabled);
  const today = todayIsoBR();
  const lines = useMemo(() => proReminderLines(data ?? [], today), [data, today]);
  const dueByRow = useMemo(() => new Map((data ?? []).map((r) => [r.id, r.due_on])), [data]);

  if (!enabled) return null;
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle>Exames e retornos</CardTitle>
        <p className="text-sm text-muted-foreground">Lembretes dos seus pacientes que já entraram na janela de aviso.</p>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Não foi possível carregar os lembretes agora.</p>
        ) : lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum exame ou retorno para avisar agora.</p>
        ) : (
          <ul className="divide-y">
            {lines.slice(0, MAX_LINES).map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md px-1 py-2 text-left hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => navigate(`/pacientes/${l.patientId}`)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {l.headline === "Retorno" ? <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <FlaskConical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-medium text-foreground">{l.patientName}</span>
                      <span className="block break-words text-xs text-muted-foreground">
                        {l.headline} · {isoDateBRText(dueByRow.get(l.id) ?? "")}
                      </span>
                    </span>
                  </span>
                  <Badge tone={l.overdue ? "destructive" : l.days === 0 ? "warning" : "muted"}>{l.when}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
        {lines.length > MAX_LINES ? <p className="pt-2 text-xs text-muted-foreground">Mais {lines.length - MAX_LINES} nas fichas dos pacientes.</p> : null}
      </CardContent>
    </Card>
  );
}
