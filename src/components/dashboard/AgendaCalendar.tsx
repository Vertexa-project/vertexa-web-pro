import { useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import ptBrLocale from "@fullcalendar/core/locales/pt-br";
import type { EventInput } from "@fullcalendar/core";

import { GOOGLE_META, STATUS_META, TYPE_META } from "@/lib/domain/agenda";
import type { AgendaItem, AppointmentView } from "@/types/db";

/**
 * Calendário da agenda (Sessão 12) — FullCalendar v6, carregado via lazy() pelo AgendaCard
 * (chunk próprio, fora do caminho crítico do Dashboard). Mês/Semana/Dia/Lista, pt-BR, timeZone
 * local (demo BR). Eventos internos (S6) são editáveis (clique = editar; arrastar/redimensionar =
 * remarcar); eventos do Google (S10) são READ-ONLY (sem editar/excluir/drag) e abrem só leitura.
 * A janela visível dispara onRangeChange (datesSet) → a busca é RANGE-DRIVEN.
 */
interface AgendaCalendarProps {
  items: AgendaItem[];
  onRangeChange: (fromISO: string, toISO: string) => void;
  onSelectInternal: (appt: AppointmentView) => void;
  onSelectGoogle: (item: AgendaItem) => void;
  onCreateAt: (start: Date, allDay: boolean) => void;
  /** Remarcar (drag/resize) — resolve a Promise da mutação; rejeição reverte o movimento. */
  onMoveInternal: (appt: AppointmentView, startISO: string, endISO: string | null) => Promise<unknown>;
}

function toEvent(item: AgendaItem): EventInput {
  const isGoogle = item.source === "google";
  const classNames: string[] = [];
  if (isGoogle) {
    classNames.push(GOOGLE_META.className);
  } else {
    if (item.appointmentType) classNames.push(TYPE_META[item.appointmentType].className); // cor (preenchimento) = TIPO
    if (item.appointmentStatus) classNames.push(STATUS_META[item.appointmentStatus].className); // barra esquerda = STATUS
  }

  // All-day do Google: usar a DATA pura (YYYY-MM-DD) sem hora/fuso evita o off-by-one (UTC↔BR).
  const start = item.all_day ? item.starts_at.slice(0, 10) : item.starts_at;
  const end = item.all_day
    ? item.ends_at
      ? item.ends_at.slice(0, 10)
      : undefined
    : (item.ends_at ?? undefined);

  return {
    id: item.id,
    title: item.title,
    start,
    end,
    allDay: item.all_day,
    editable: !isGoogle,
    startEditable: !isGoogle,
    durationEditable: !isGoogle,
    classNames,
    extendedProps: {
      source: item.source,
      appointmentType: item.appointmentType,
      appointmentStatus: item.appointmentStatus,
      googleEventStatus: item.googleEventStatus,
    },
  };
}

export default function AgendaCalendar({
  items,
  onRangeChange,
  onSelectInternal,
  onSelectGoogle,
  onCreateAt,
  onMoveInternal,
}: AgendaCalendarProps) {
  const events = useMemo(() => items.map(toEvent), [items]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  return (
    <div className="vtx-cal h-[640px]">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        locale={ptBrLocale}
        timeZone="local"
        height="100%"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
        }}
        buttonText={{ today: "Hoje", month: "Mês", week: "Semana", day: "Dia", list: "Lista" }}
        allDaySlot
        nowIndicator
        expandRows
        dayMaxEvents={3}
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        scrollTime="07:00:00"
        eventOverlap
        editable
        events={events}
        // A agenda interna não tem compromisso de dia inteiro → impede arrastar p/ a faixa all-day
        // (evitaria gravar starts_at à meia-noite sem efeito visual). Google não é arrastável.
        eventAllow={(dropInfo) => !dropInfo.allDay}
        eventDidMount={(arg) => {
          // Distinção do Google não pode depender só da cor (a11y): rótulo + tooltip "somente leitura".
          if (arg.event.extendedProps.source === "google") {
            const label = `Google, somente leitura: ${arg.event.title}`;
            arg.el.setAttribute("aria-label", label);
            arg.el.setAttribute("title", label);
          }
        }}
        datesSet={(arg) => onRangeChange(arg.start.toISOString(), arg.end.toISOString())}
        eventClick={(arg) => {
          const item = byId.get(arg.event.id);
          if (!item) return;
          if (item.source === "internal" && item.appointment) onSelectInternal(item.appointment);
          else if (item.source === "google") onSelectGoogle(item);
        }}
        dateClick={(arg) => onCreateAt(arg.date, arg.allDay)}
        eventDrop={(arg) => {
          const item = byId.get(arg.event.id);
          if (!item || item.source !== "internal" || !item.appointment) {
            arg.revert();
            return;
          }
          const startISO = arg.event.start ? arg.event.start.toISOString() : item.appointment.starts_at;
          const endISO = arg.event.end ? arg.event.end.toISOString() : null;
          void onMoveInternal(item.appointment, startISO, endISO).catch(() => arg.revert());
        }}
        eventResize={(arg) => {
          const item = byId.get(arg.event.id);
          if (!item || item.source !== "internal" || !item.appointment) {
            arg.revert();
            return;
          }
          const startISO = arg.event.start ? arg.event.start.toISOString() : item.appointment.starts_at;
          const endISO = arg.event.end ? arg.event.end.toISOString() : null;
          void onMoveInternal(item.appointment, startISO, endISO).catch(() => arg.revert());
        }}
      />
    </div>
  );
}
