import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarPlus, Loader2 } from "lucide-react";

import { AppointmentDialog } from "./AppointmentDialog";
import { IntegrationsMenu } from "@/components/calendar/IntegrationsMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgenda, useUpdateAppointment } from "@/hooks/useAppointments";
import type { AppointmentInput } from "@/lib/api/appointments";
import { GOOGLE_META, STATUS_LEGEND, TYPE_LEGEND } from "@/lib/domain/agenda";
import type { AgendaItem, AppointmentView } from "@/types/db";

// FullCalendar é pesado (~300 KB gzip) → carregado sob demanda, fora do bundle do Dashboard.
const AgendaCalendar = lazy(() => import("./AgendaCalendar"));

function googleEventWhen(item: AgendaItem): string {
  if (item.all_day) return `Dia inteiro · ${format(parseISO(item.starts_at), "dd/MM/yyyy", { locale: ptBR })}`;
  const start = format(parseISO(item.starts_at), "dd/MM/yyyy HH:mm", { locale: ptBR });
  const end = item.ends_at ? format(parseISO(item.ends_at), "HH:mm") : null;
  return end ? `${start}–${end}` : start;
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Resumo da faixa visível (deriva dos eventos já carregados — não inventa). */
function summaryText(s: { internal: number; confirmado: number; pendente: number; desmarcado: number; google: number }): string {
  if (s.internal === 0 && s.google === 0) return "Sem compromissos nesta faixa.";
  const parts: string[] = [];
  if (s.internal > 0) {
    parts.push(plural(s.internal, "compromisso", "compromissos"));
    parts.push(plural(s.confirmado, "confirmado", "confirmados"));
    parts.push(plural(s.pendente, "pendente", "pendentes"));
    parts.push(plural(s.desmarcado, "desmarcado", "desmarcados"));
  }
  if (s.google > 0) parts.push(`${s.google} no Google`);
  return parts.join(" · ");
}

function Legend({ title, items }: { title: string; items: { key: string; label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-medium text-muted-foreground">{title}:</span>
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: it.color }} aria-hidden />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Agenda do Dashboard (Sessão 12) — calendário FullCalendar (Mês/Semana/Dia/Lista) que mescla a
 * agenda INTERNA (CRUD da S6, com tipo/status e cor) e os eventos do GOOGLE (S10, read-only, laranja).
 * A busca é RANGE-DRIVEN (datesSet → faixa visível). Integrações ficam num dropdown no topo (S12).
 */
export function AgendaCard({
  clinicId,
  defaultProfessionalId,
}: {
  clinicId: string | null;
  defaultProfessionalId: string | null;
}) {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AppointmentView | null>(null);
  const [createStart, setCreateStart] = useState<Date | null>(null);
  const [googleView, setGoogleView] = useState<AgendaItem | null>(null);

  const { items, isFetching, isError, googleError, refetch } = useAgenda(
    clinicId,
    defaultProfessionalId,
    range?.from ?? null,
    range?.to ?? null,
  );
  const update = useUpdateAppointment(clinicId ?? "none");

  const onRangeChange = useCallback((from: string, to: string) => {
    setRange((prev) => (prev && prev.from === from && prev.to === to ? prev : { from, to }));
  }, []);

  function openCreate() {
    setEditing(null);
    setCreateStart(null);
    setDialogOpen(true);
  }
  const onCreateAt = useCallback((start: Date, allDay: boolean) => {
    // Slot de mês/all-day não tem hora → ancora às 09:00 do dia clicado.
    const base = allDay
      ? new Date(start.getFullYear(), start.getMonth(), start.getDate(), 9, 0, 0)
      : start;
    setEditing(null);
    setCreateStart(base);
    setDialogOpen(true);
  }, []);
  const onSelectInternal = useCallback((appt: AppointmentView) => {
    setCreateStart(null);
    setEditing(appt);
    setDialogOpen(true);
  }, []);
  const onSelectGoogle = useCallback((item: AgendaItem) => setGoogleView(item), []);

  // Remarcar via arrastar/redimensionar (só interno). Retorna a Promise da mutação;
  // se rejeitar, o AgendaCalendar reverte o movimento na própria UI do FullCalendar.
  const onMoveInternal = useCallback(
    (appt: AppointmentView, startISO: string, endISO: string | null) => {
      const input: AppointmentInput = {
        clinicId: appt.clinic_id,
        title: appt.title,
        startsAt: startISO,
        endsAt: endISO,
        patientId: appt.patient_id,
        professionalId: appt.professional_id,
        notes: appt.notes,
        type: appt.type,
        status: appt.status,
      };
      return update.mutateAsync({ id: appt.id, input });
    },
    [update],
  );

  // Resumo da faixa visível (recalcula quando items muda — i.e., a cada datesSet/refetch).
  const summary = useMemo(() => {
    const s = { internal: 0, confirmado: 0, pendente: 0, desmarcado: 0, google: 0 };
    for (const it of items) {
      if (it.source === "google") {
        s.google += 1;
        continue;
      }
      s.internal += 1;
      if (it.appointmentStatus === "confirmado") s.confirmado += 1;
      else if (it.appointmentStatus === "pendente") s.pendente += 1;
      else if (it.appointmentStatus === "desmarcado") s.desmarcado += 1;
    }
    return s;
  }, [items]);

  const typeLegend = [
    ...TYPE_LEGEND.map((t) => ({ key: t.key as string, label: t.label, color: t.color })),
    { key: "google", label: GOOGLE_META.label, color: GOOGLE_META.color },
  ];
  const statusLegend = STATUS_LEGEND.map((s) => ({ key: s.key as string, label: s.label, color: s.color }));

  return (
    <Card className="flex flex-col">
      <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Agenda</CardTitle>
          {/* Resumo da faixa visível (densidade útil) — número + rótulo, discreto. */}
          <p className="tnum text-xs text-muted-foreground">{summaryText(summary)}</p>
        </div>
        <div className="flex items-center gap-2">
          <IntegrationsMenu clinicId={clinicId} professionalId={defaultProfessionalId} />
          <Button size="sm" onClick={openCreate} disabled={!clinicId}>
            <CalendarPlus className="h-4 w-4" />
            Novo compromisso
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col">
        {/* Atualizando a faixa visível (navegação/troca de view) — eventos anteriores seguem na tela
            (keepPreviousData); este é o feedback de carregamento da nova janela. */}
        {isFetching && !isError ? (
          <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Atualizando agenda…
          </p>
        ) : null}
        {/* Falha do Google é sinalizada sem derrubar a agenda interna (S10). */}
        {!isFetching && !isError && googleError ? (
          <p className="mb-2 text-xs text-muted-foreground" role="status">
            Mostrando a agenda interna. Não foi possível carregar os eventos do Google agora.
          </p>
        ) : null}
        {/* Remarcar (arrastar/redimensionar) falhou: o evento volta à posição e avisamos o motivo. */}
        {update.isError ? (
          <p className="mb-2 text-sm text-destructive" role="alert">
            Não foi possível remarcar o compromisso. Tente novamente.
          </p>
        ) : null}
        {isError ? (
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Não foi possível carregar a agenda.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : null}

        <Suspense fallback={<Skeleton className="h-[720px] w-full" />}>
          <AgendaCalendar
            items={items}
            onRangeChange={onRangeChange}
            onSelectInternal={onSelectInternal}
            onSelectGoogle={onSelectGoogle}
            onCreateAt={onCreateAt}
            onMoveInternal={onMoveInternal}
          />
        </Suspense>

        {/* Duas legendas (como o Nutrio): cores por TIPO de evento e por STATUS do agendamento. */}
        <div className="mt-3 flex flex-col gap-2 border-t pt-3 text-xs sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-8">
          <Legend title="Tipos de evento" items={typeLegend} />
          <Legend title="Status do agendamento" items={statusLegend} />
        </div>
      </CardContent>

      {clinicId ? (
        <AppointmentDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          clinicId={clinicId}
          existing={editing}
          defaultProfessionalId={defaultProfessionalId}
          initialStart={createStart}
        />
      ) : null}

      {/* Leitura de evento do Google (read-only — sem editar/excluir). */}
      <Dialog open={Boolean(googleView)} onOpenChange={(o) => !o && setGoogleView(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="truncate">{googleView?.title}</span>
              <Badge tone="muted" className="shrink-0">
                Google
              </Badge>
            </DialogTitle>
            <DialogDescription>Evento do Google Agenda — somente leitura.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-foreground">{googleView ? googleEventWhen(googleView) : null}</p>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
