import { muscleGroupLabel, muscleStatusLabel, muscleStatusTone } from "@/lib/domain/muscleRecovery";
import type { BadgeTone } from "@/lib/domain/vri";
import type { MuscleRecoveryState, MuscleStatus } from "@/types/db";

const toneVar: Record<BadgeTone, string> = {
  destructive: "hsl(var(--destructive))",
  warning: "hsl(var(--warning))",
  info: "hsl(var(--info))",
  success: "hsl(var(--success))",
  primary: "hsl(var(--primary))",
  muted: "hsl(var(--muted-foreground))",
};

interface Slot {
  key: string;
  cx: number;
  cy: number;
}

// Slots em viewBox 120x180 (silhueta estilizada).
const FRONT: Slot[] = [
  { key: "shoulders", cx: 44, cy: 44 },
  { key: "shoulders", cx: 76, cy: 44 },
  { key: "chest", cx: 60, cy: 50 },
  { key: "biceps", cx: 37, cy: 58 },
  { key: "biceps", cx: 83, cy: 58 },
  { key: "abs", cx: 60, cy: 70 },
  { key: "forearms", cx: 33, cy: 76 },
  { key: "forearms", cx: 87, cy: 76 },
  { key: "quadriceps", cx: 52, cy: 116 },
  { key: "quadriceps", cx: 68, cy: 116 },
];

const BACK: Slot[] = [
  { key: "traps", cx: 60, cy: 42 },
  { key: "lats", cx: 60, cy: 56 },
  { key: "triceps", cx: 37, cy: 58 },
  { key: "triceps", cx: 83, cy: 58 },
  { key: "lower_back", cx: 60, cy: 72 },
  { key: "glutes", cx: 60, cy: 92 },
  { key: "hamstrings", cx: 52, cy: 120 },
  { key: "hamstrings", cx: 68, cy: 120 },
  { key: "calves", cx: 52, cy: 150 },
  { key: "calves", cx: 68, cy: 150 },
];

function Silhouette({
  slots,
  statusByKey,
  title,
}: {
  slots: Slot[];
  statusByKey: Map<string, MuscleStatus>;
  title: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 120 180" className="h-64 w-auto" aria-hidden="true">
        <g fill="hsl(var(--muted))" stroke="hsl(var(--border))" strokeWidth={1}>
          <circle cx={60} cy={18} r={11} />
          <rect x={45} y={32} width={30} height={50} rx={10} />
          <rect x={28} y={36} width={12} height={42} rx={6} />
          <rect x={80} y={36} width={12} height={42} rx={6} />
          <rect x={46} y={82} width={13} height={74} rx={6} />
          <rect x={61} y={82} width={13} height={74} rx={6} />
        </g>
        {slots.map((slot, i) => {
          const status = statusByKey.get(slot.key);
          const fill = status ? toneVar[muscleStatusTone(status)] : "hsl(var(--muted-foreground))";
          return (
            <circle
              key={`${slot.key}-${i}`}
              cx={slot.cx}
              cy={slot.cy}
              r={5.5}
              fill={fill}
              fillOpacity={status ? 1 : 0.3}
              stroke="hsl(var(--card))"
              strokeWidth={1.25}
            >
              <title>
                {muscleGroupLabel(slot.key)}
                {status ? ` — ${muscleStatusLabel(status)}` : " — sem dados"}
              </title>
            </circle>
          );
        })}
      </svg>
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
    </div>
  );
}

const LEGEND: { status: MuscleStatus }[] = [
  { status: "fatigued" },
  { status: "recovering" },
  { status: "recovered" },
  { status: "weakened" },
];

export function BodyMap({ states }: { states: MuscleRecoveryState[] }) {
  const statusByKey = new Map<string, MuscleStatus>();
  states.forEach((s) => statusByKey.set(s.muscle_group.toLowerCase(), s.status));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-center gap-8">
        <Silhouette slots={FRONT} statusByKey={statusByKey} title="Frente" />
        <Silhouette slots={BACK} statusByKey={statusByKey} title="Costas" />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {LEGEND.map(({ status }) => (
          <div key={status} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: toneVar[muscleStatusTone(status)] }}
            />
            {muscleStatusLabel(status)}
          </div>
        ))}
      </div>
    </div>
  );
}
