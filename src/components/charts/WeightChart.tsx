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
import type { BodyAssessment } from "@/types/db";

export function WeightChart({ assessments }: { assessments: BodyAssessment[] }) {
  const data = assessments
    .filter((a) => a.weight != null && a.assessed_at)
    .map((a) => ({
      date: a.assessed_at as string,
      label: formatDate(a.assessed_at as string),
      peso: Number(a.weight),
    }));

  if (data.length === 0) return null;

  const weights = data.map((d) => d.peso);
  const min = Math.floor(Math.min(...weights) - 2);
  const max = Math.ceil(Math.max(...weights) + 2);

  return (
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
          dot={{ r: 4, fill: "hsl(var(--primary))" }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
