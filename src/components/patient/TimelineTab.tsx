import { Clock } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { Card, CardContent } from "@/components/ui/card";
import { usePatientTimeline } from "@/hooks/usePatientTimeline";
import { activityEventDescription, activityEventMeta } from "@/lib/domain/activityEvents";
import { formatRelative } from "@/lib/domain/format";
import type { BadgeTone } from "@/lib/domain/vri";
import { cn } from "@/lib/utils";

const toneBg: Record<BadgeTone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning-foreground",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
  primary: "bg-primary/10 text-primary",
  muted: "bg-muted text-muted-foreground",
};

export function TimelineTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, refetch } = usePatientTimeline(patientId);

  return (
    <AsyncSection
      isLoading={isLoading}
      isError={isError}
      isEmpty={!data || data.length === 0}
      onRetry={() => refetch()}
      emptyIcon={Clock}
      emptyTitle="Sem atividades ainda"
      emptyDescription="Quando o paciente registrar treinos, peso ou check-ins no app, aparecerão aqui."
    >
      <Card>
        <CardContent className="p-6">
          <ol className="space-y-5">
            {data?.map((ev) => {
              const meta = activityEventMeta(ev.type);
              const desc = activityEventDescription(ev.type, ev.payload);
              const Icon = meta.icon;
              return (
                <li key={ev.id} className="flex gap-4">
                  <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", toneBg[meta.tone])}>
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{meta.label}</p>
                    {desc ? <p className="text-sm text-muted-foreground">{desc}</p> : null}
                    <time dateTime={ev.created_at} className="mt-0.5 block text-xs text-muted-foreground">
                      {formatRelative(ev.created_at)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </AsyncSection>
  );
}
