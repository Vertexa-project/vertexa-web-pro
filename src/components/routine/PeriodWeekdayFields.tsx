import { PERIOD_OPTIONS, WEEKDAYS, type RoutinePeriod } from "@/lib/domain/routine";

const SELECT = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground";

/** Período (não pedir / toda semana / todo mês) + dia da semana de UM item da rotina. */
export function PeriodWeekdayFields({ id, label, period, weekday, onChange }: {
  id: string; label: string; period: RoutinePeriod; weekday: number; onChange: (v: { period: RoutinePeriod; weekday: number }) => void;
}) {
  return (
    <div className="space-y-1.5 py-3">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <select id={`${id}-period`} aria-label={`${label}: quando pedir`} className={SELECT} value={period} onChange={(e) => onChange({ period: e.target.value as RoutinePeriod, weekday })}>
          {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select id={`${id}-weekday`} aria-label={`${label}: dia da semana`} className={SELECT} value={weekday} disabled={period === "off"} onChange={(e) => onChange({ period, weekday: Number(e.target.value) })}>
          {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      </div>
    </div>
  );
}
