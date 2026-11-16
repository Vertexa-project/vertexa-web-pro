import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus } from "lucide-react";

import { ErrorState } from "@/components/feedback/ErrorState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgenda } from "@/hooks/useAppointments";
import { timeBR, todayRangeBR } from "@/lib/domain/hoje";
import type { AgendaItem } from "@/types/db";

function rowLabel(i: AgendaItem): { title: string; sub: string | null } {
  if (i.source === "google") return { title: i.title, sub: null };
  return { title: i.patient_name ?? i.title, sub: i.patient_name ? i.title : null };
}

/** Agenda de hoje (resumo no Hoje). O calendário completo segue em /agenda. */
export function TodayAgenda({
  clinicId,
  professionalId,
  onCount,
}: {
  clinicId: string | null;
  professionalId: string | null;
  onCount?: (n: number) => void;
}) {
  const navigate = useNavigate();
  // Janela fixa durante a vida do componente (dia de Brasília): a queryKey não muda a cada render.
  const range = useMemo(() => todayRangeBR(), []);
  const { items, isLoading, isError, refetch } = useAgenda(clinicId, professionalId, range.from, range.to);
  const today = useMemo(() => items.filter((i) => i.appointmentStatus !== "desmarcado"), [items]);
  useEffect(() => {
    if (!isLoading && !isError) onCount?.(today.length);
  }, [isLoading, isError, today.length, onCount]);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>Agenda de hoje</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : isError ? (
          <ErrorState className="py-6" onRetry={refetch} />
        ) : today.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum compromisso hoje.</p>
        ) : (
          <ul className="space-y-3">
            {today.map((i) => {
              const { title, sub } = rowLabel(i);
              return (
                <li key={i.id} className="flex items-start gap-3">
                  <span className="tnum w-12 shrink-0 pt-0.5 text-sm font-semibold text-foreground">
                    {i.all_day ? "Dia todo" : timeBR(i.starts_at)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-foreground">{title}</p>
                    {sub ? <p className="break-words text-xs text-muted-foreground">{sub}</p> : null}
                  </div>
                  {i.source === "google" ? <Badge tone="muted">Google</Badge> : null}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-auto flex flex-wrap justify-end gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={() => navigate("/agenda")}>
            Ver semana
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/agenda")}>
            <CalendarPlus className="h-4 w-4" aria-hidden />
            Novo compromisso
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
