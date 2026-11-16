import { useMemo } from "react";
import { Clock, FileUp, ListChecks } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { Card, CardContent } from "@/components/ui/card";
import { usePatientImportOrigin } from "@/hooks/usePatientImportExport";
import { usePatientTimeline } from "@/hooks/usePatientTimeline";
import { activityEventDescription, activityEventMeta } from "@/lib/domain/activityEvents";
import { dateTimeBR } from "@/lib/domain/clinicalDocs";
import { formatRelative } from "@/lib/domain/format";
import { importOriginLabel } from "@/lib/domain/patientImport";
import { groupTimeline } from "@/lib/domain/timelineGroups";
import type { BadgeTone } from "@/lib/domain/vri";
import { cn } from "@/lib/utils";

const toneBg: Record<BadgeTone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning-foreground dark:text-warning",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
  primary: "bg-primary/10 text-primary",
  muted: "bg-muted text-muted-foreground",
};

const dayBR = (day: string) => day.split("-").reverse().join("/");
const timeBR = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

export function TimelineTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, refetch } = usePatientTimeline(patientId);
  const items = useMemo(() => groupTimeline(data ?? []), [data]);
  // Origem do cadastro (só quem veio de importação por planilha): é o evento mais antigo da Timeline.
  const origin = usePatientImportOrigin(patientId).data ?? null;

  return (
    <AsyncSection
      isLoading={isLoading}
      isError={isError}
      isEmpty={(!data || data.length === 0) && !origin}
      onRetry={() => refetch()}
      emptyIcon={Clock}
      emptyTitle="Sem atividades ainda"
      emptyDescription="Quando o paciente registrar treinos, peso ou check-ins no app, aparecerão aqui."
    >
      <Card>
        <CardContent className="p-6">
          <ol className="space-y-5">
            {items.map((item) => {
              if (item.kind === "habits") {
                return (
                  <li key={`habits-${item.day}`} className="flex gap-4">
                    <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", toneBg.info)}>
                      <ListChecks className="h-5 w-5" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">Hábitos do dia</p>
                      <p className="text-sm text-muted-foreground">{item.summary}</p>
                      <time dateTime={item.latestAt} className="mt-0.5 block text-xs text-muted-foreground">
                        {dayBR(item.day)} · último registro {timeBR(item.latestAt)}
                      </time>
                    </div>
                  </li>
                );
              }
              const ev = item.event;
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
                      {formatRelative(ev.created_at)} · {dateTimeBR(ev.created_at)}
                    </time>
                  </div>
                </li>
              );
            })}
            {origin ? (
              <li className="flex gap-4">
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", toneBg.muted)}>
                  <FileUp className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="break-words font-medium text-foreground">{importOriginLabel(origin.source_filename)}</p>
                  <p className="text-sm text-muted-foreground">Cadastro criado por importação de planilha.</p>
                  <time dateTime={origin.imported_at} className="mt-0.5 block text-xs text-muted-foreground">
                    {dateTimeBR(origin.imported_at)}
                  </time>
                </div>
              </li>
            ) : null}
          </ol>
        </CardContent>
      </Card>
    </AsyncSection>
  );
}
