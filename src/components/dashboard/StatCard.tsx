import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tone = "default" | "primary" | "success" | "warning" | "destructive";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  tone?: Tone;
}

const toneClasses: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning-foreground",
  destructive: "bg-destructive/10 text-destructive",
};

export function StatCard({ icon: Icon, label, value, hint, tone = "default" }: StatCardProps) {
  return (
    <Card className="transition-shadow duration-200 hover:shadow-elevated">
      <CardContent className="flex items-start gap-3 p-4 sm:p-5">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", toneClasses[tone])}>
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          {/* Sem truncate: rótulos curtos podem quebrar em 2 linhas em telas estreitas.
              min-h reserva 2 linhas → os números ficam ~na mesma baseline entre cards. */}
          <p className="flex min-h-[2.25rem] items-start text-xs font-medium leading-tight text-muted-foreground">
            {label}
          </p>
          <p className="tnum mt-1 font-display text-2xl font-bold leading-none tracking-tight text-foreground">
            {value}
          </p>
          {hint ? <p className="mt-1 text-xs leading-tight text-muted-foreground">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
