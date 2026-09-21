import { Loader2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useClinicBillingTimeline } from "@/hooks/useBillingHub";
import {
  billingHubErrorMessage,
  formatBillingCivilDate,
  providerEnvironmentLabel,
  sortTimelineNewestFirst,
  timelineEventLabel,
  type ClinicBillingTimelineEvent,
} from "@/lib/domain/billingHub";

export function BillingHubTimeline({ clinicId }: { clinicId: string }) {
  const query = useClinicBillingTimeline(clinicId, true);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Linha do tempo</CardTitle>
        <CardDescription>Eventos de negócio da assinatura, do mais recente ao mais antigo.</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span role="status">Carregando a linha do tempo…</span>
          </p>
        ) : null}
        {query.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {billingHubErrorMessage(query.error)}
          </p>
        ) : null}
        {!query.isLoading && !query.isError && (query.data?.length ?? 0) === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            Ainda não há eventos de faturamento para mostrar.
          </p>
        ) : null}
        {query.data && query.data.length > 0 ? (
          <TimelineList items={sortTimelineNewestFirst(query.data)} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function TimelineList({ items }: { items: ClinicBillingTimelineEvent[] }) {
  return (
    <ol className="space-y-3" aria-label="Linha do tempo de faturamento">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {timelineEventLabel(item.type)}
              {providerEnvironmentLabel(item.environment) ? (
                <span className="ml-2 inline-flex rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {providerEnvironmentLabel(item.environment)}
                </span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">{formatBillingCivilDate(item.occurredAt)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
