import { HeartPulse } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { BodyMap } from "./BodyMap";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMuscleRecovery } from "@/hooks/useMuscleRecovery";
import { muscleGroupLabel, muscleStatusLabel, muscleStatusTone } from "@/lib/domain/muscleRecovery";
import { formatRelative } from "@/lib/domain/format";

export function RecoveryTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, refetch } = useMuscleRecovery(patientId);

  return (
    <AsyncSection
      isLoading={isLoading}
      isError={isError}
      isEmpty={!data || data.length === 0}
      onRetry={() => refetch()}
      emptyIcon={HeartPulse}
      emptyTitle="Sem dados de recuperação"
      emptyDescription="O mapa é alimentado pelos treinos registrados no app do paciente."
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Mapa de recuperação muscular</CardTitle>
          </CardHeader>
          <CardContent>{data ? <BodyMap states={data} /> : null}</CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Grupos monitorados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{muscleGroupLabel(m.muscle_group)}</p>
                  {m.last_trained_at ? (
                    <p className="text-xs text-muted-foreground">Treinado {formatRelative(m.last_trained_at)}</p>
                  ) : null}
                </div>
                <Badge tone={muscleStatusTone(m.status)}>{muscleStatusLabel(m.status)}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AsyncSection>
  );
}
