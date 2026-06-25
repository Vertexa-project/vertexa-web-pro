import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, CalendarPlus, Loader2, Pencil, Trash2 } from "lucide-react";

import { AppointmentDialog } from "./AppointmentDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppointments, useDeleteAppointment, type AgendaScope } from "@/hooks/useAppointments";
import { cn } from "@/lib/utils";
import type { AppointmentView } from "@/types/db";

function timeRange(a: AppointmentView): string {
  const start = format(parseISO(a.starts_at), "HH:mm");
  const end = a.ends_at ? format(parseISO(a.ends_at), "HH:mm") : null;
  return end ? `${start}–${end}` : start;
}

function AppointmentRow({
  appt,
  scope,
  deleting,
  onEdit,
  onDelete,
}: {
  appt: AppointmentView;
  scope: AgendaScope;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const who = [appt.patient_name, appt.professional_name].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent/40">
      <div className="flex w-20 shrink-0 flex-col">
        {scope === "week" ? (
          <span className="text-[11px] font-medium uppercase text-muted-foreground">
            {format(parseISO(appt.starts_at), "EEE dd/MM", { locale: ptBR })}
          </span>
        ) : null}
        <span className="tnum font-display text-sm font-semibold text-foreground">{timeRange(appt)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{appt.title}</p>
        <p className="truncate text-xs text-muted-foreground">{who || "Sem vínculo"}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={`Editar ${appt.title}`}
          onClick={onEdit}
          disabled={deleting}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          aria-label={`Excluir ${appt.title}`}
          onClick={onDelete}
          disabled={deleting}
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>
    </li>
  );
}

/**
 * Agenda interna no Dashboard (Review §3). Lista compromissos do dia/semana da clínica
 * (dados reais) + CRUD real. "Conectar Google Agenda" é gancho placeholder (dívida #19).
 * Escopado por clínica do profissional logado (isolamento).
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

  const { data, isLoading, isError, refetch } = useAppointments(clinicId, scope);
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

  const items = data ?? [];

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
              {items.map((appt) => (
                <AppointmentRow
                  key={appt.id}
                  appt={appt}
                  scope={scope}
                  deleting={del.isPending && del.variables === appt.id}
                  onEdit={() => openEdit(appt)}
                  onDelete={() => handleDelete(appt)}
                />
              ))}
            </ul>
          </>
        )}

        {/* Gancho de roadmap: trocar a fonte da agenda pela API do Google quando vierem
            as credenciais (⛔ pendência #19). Google Meet NÃO entra. */}
        <div className="mt-4 border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center text-muted-foreground"
            disabled
            aria-disabled
          >
            <CalendarClock className="h-4 w-4" />
            Conectar Google Agenda
            <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
              Em breve
            </span>
          </Button>
          {/* Intenção do gancho explícita no DOM (não depende de tooltip/hover). */}
          <p className="mt-1.5 text-center text-xs text-muted-foreground">
            Agenda interna por enquanto. Quando as credenciais do Google forem configuradas, ela sincroniza aqui.
          </p>
        </div>
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
