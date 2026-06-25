import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatDate } from "@/lib/domain/format";
import type { WeightPoint } from "@/types/db";

interface DotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: { source?: WeightPoint["source"] };
}

// Cor do ponto por origem: registro do app = laranja (primary); avaliação clínica = azul (info).
function renderDot({ cx, cy, index, payload }: DotProps) {
  const key = `weight-dot-${index ?? 0}`;
  if (cx == null || cy == null) return <g key={key} />;
  const fill = payload?.source === "app" ? "hsl(var(--primary))" : "hsl(var(--info))";
  return (
    <circle
      key={key}
      cx={cx}
      cy={cy}
      r={4}
      fill={fill}
      stroke="hsl(var(--card))"
      strokeWidth={1.5}
    />
  );
}

export function WeightChart({ points }: { points: WeightPoint[] }) {
  const data = points
    .filter((p) => p.weight != null && p.date)
    .map((p) => ({
      date: p.date,
      label: formatDate(p.date),
      peso: Number(p.weight),
      source: p.source,
    }));

  if (data.length === 0) return null;

  const weights = data.map((d) => d.peso);
  const min = Math.floor(Math.min(...weights) - 2);
  const max = Math.ceil(Math.max(...weights) + 2);

  return (
    <div
      role="img"
      aria-label="Gráfico de evolução de peso: avaliações clínicas (azul) e registros do app (laranja)"
    >
      <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          fontSize={12}
          interval="preserveStartEnd"
          stroke="hsl(var(--muted-foreground))"
        />
        <YAxis
          domain={[min, max]}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          stroke="hsl(var(--muted-foreground))"
          unit=" kg"
          width={56}
        />
        <Tooltip
          formatter={(value: number) => [`${value} kg`, "Peso"]}
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "hsl(var(--foreground))" }}
        />
        <Line
          type="monotone"
          dataKey="peso"
          stroke="hsl(var(--primary))"
          strokeWidth={2.5}
          dot={renderDot}
          activeDot={{ r: 6 }}
        />
      </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
