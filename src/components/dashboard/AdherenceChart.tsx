import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PatientListItem } from "@/types/db";

// Cor pela própria métrica de adesão (não pelo status) — leitura coerente com o eixo.
function adherenceColor(rate: number): string {
  if (rate >= 70) return "hsl(var(--success))";
  if (rate >= 40) return "hsl(var(--warning))";
  return "hsl(var(--destructive))";
}

export function AdherenceChart({ patients }: { patients: PatientListItem[] }) {
  const data = patients.map((p) => ({
    id: p.id,
    name: (p.profile?.full_name ?? "—").split(" ")[0],
    adesao: p.snapshot?.weekly_completion_rate ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          fontSize={12}
          stroke="hsl(var(--muted-foreground))"
        />
        <YAxis
          domain={[0, 100]}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          stroke="hsl(var(--muted-foreground))"
          unit="%"
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
          formatter={(value: number) => [`${value}%`, "Adesão semanal"]}
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: "hsl(var(--foreground))" }}
        />
        <Bar dataKey="adesao" radius={[6, 6, 0, 0]} maxBarSize={56}>
          {data.map((d) => (
            <Cell key={d.id} fill={adherenceColor(d.adesao)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
