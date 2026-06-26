import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, CalendarPlus, Loader2, Pencil, Trash2 } from "lucide-react";

import { AppointmentDialog } from "./AppointmentDialog";
import { GoogleCalendarConnection } from "@/components/calendar/GoogleCalendarConnection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgenda, useDeleteAppointment, type AgendaScope } from "@/hooks/useAppointments";
import { cn } from "@/lib/utils";
import type { AgendaItem, AppointmentView } from "@/types/db";

function timeRange(item: AgendaItem): string {
  if (item.all_day) return "Dia inteiro";
  const start = format(parseISO(item.starts_at), "HH:mm");
  const end = item.ends_at ? format(parseISO(item.ends_at), "HH:mm") : null;
  return end ? `${start}–${end}` : start;
}

function AgendaItemRow({
  item,
  scope,
  deleting,
  onEdit,
  onDelete,
}: {
  item: AgendaItem;
  scope: AgendaScope;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isGoogle = item.source === "google";
  const who = isGoogle
    ? "Google Agenda"
    : [item.patient_name, item.professional_name].filter(Boolean).join(" · ") || "Sem vínculo";
  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/40">
      <div className="flex w-20 shrink-0 flex-col">
        {scope === "week" ? (
          <span className="text-[11px] font-medium uppercase text-muted-foreground">
            {format(parseISO(item.starts_at), "EEE dd/MM", { locale: ptBR })}
          </span>
        ) : null}
        <span className="tnum font-display text-sm font-semibold text-foreground">{timeRange(item)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <span className="truncate">{item.title}</span>
          {isGoogle ? (
            <Badge tone="muted" className="shrink-0">
              Google
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground">{who}</p>
      </div>
      {/* Eventos do Google são READ-ONLY (sem editar/excluir). CRUD só para a agenda interna. */}
      {isGoogle ? null : (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={`Editar ${item.title}`}
            onClick={onEdit}
            disabled={deleting}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            aria-label={`Excluir ${item.title}`}
            onClick={onDelete}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Agenda no Dashboard (Review §3 + Sessão 10). Mescla a agenda INTERNA (CRUD real, S6) com os
 * eventos do GOOGLE CALENDAR (somente leitura) — cada item traz a fonte. O CRUD interno segue
 * intacto; eventos Google não são editados/excluídos. Escopado por clínica (isolamento).
 */
export function AgendaCard({
  clinicId,
  defaultProfessionalId,
}: {
  clinicId: string | null;
  defaultProfessionalId: string | null;
}) {
  const [scope, setScope] = useState<AgendaScope>("today");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AppointmentView | null>(null);

  const { items, isLoading, isError, googleError, refetch } = useAgenda(clinicId, scope);
  const del = useDeleteAppointment(clinicId ?? "none");

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(appt: AppointmentView) {
    setEditing(appt);
    setDialogOpen(true);
  }
  function handleDelete(appt: AppointmentView) {
    // Confirmação simples (sprint) — evita exclusão acidental sem um diálogo dedicado.
    if (window.confirm(`Excluir "${appt.title}"?`)) del.mutate(appt.id);
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Agenda</CardTitle>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Período da agenda" className="flex rounded-lg border bg-muted/40 p-0.5">
            {(["today", "week"] as AgendaScope[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  scope === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s === "today" ? "Hoje" : "Semana"}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={openCreate} disabled={!clinicId}>
            <CalendarPlus className="h-4 w-4" />
            Novo compromisso
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col">
        {/* Falha do Google é sinalizada SEMPRE (inclusive no estado vazio) p/ não passar "nada agendado"
            quando na verdade os eventos do Google não carregaram. A agenda interna segue funcionando. */}
        {!isLoading && !isError && googleError ? (
          <p className="mb-2 text-xs text-muted-foreground" role="status">
            Mostrando a agenda interna. Não foi possível carregar os eventos do Google agora.
          </p>
        ) : null}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex items-center justify-between gap-3 py-2">
            <p className="text-sm text-muted-foreground">Não foi possível carregar a agenda.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
              <CalendarClock className="h-5 w-5" />
            </span>
            <p className="text-sm text-muted-foreground">
              {scope === "today" ? "Nada agendado para hoje." : "Nenhum compromisso nesta semana."}
            </p>
            <Button variant="outline" size="sm" onClick={openCreate} disabled={!clinicId}>
              <CalendarPlus className="h-4 w-4" />
              Agendar
            </Button>
          </div>
        ) : (
          <>
            {del.isError ? (
              <p className="mb-2 text-sm text-destructive" role="alert">
                Não foi possível excluir o compromisso. Tente novamente.
              </p>
            ) : null}
            <ul className="space-y-2">
              {items.map((item) => (
                <AgendaItemRow
                  key={item.id}
                  item={item}
                  scope={scope}
                  deleting={del.isPending && item.appointment ? del.variables === item.appointment.id : false}
                  onEdit={() => item.appointment && openEdit(item.appointment)}
                  onDelete={() => item.appointment && handleDelete(item.appointment)}
                />
              ))}
            </ul>
          </>
        )}

        {/* Integração Google Calendar (read-only) — substitui o placeholder da S6 (#19). Google Meet fora. */}
        <GoogleCalendarConnection
          clinicId={clinicId}
          professionalId={defaultProfessionalId}
          variant="compact"
        />
      </CardContent>

      {clinicId ? (
        <AppointmentDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          clinicId={clinicId}
          existing={editing}
          defaultProfessionalId={defaultProfessionalId}
        />
      ) : null}
    </Card>
  );
}
