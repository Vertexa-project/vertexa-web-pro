import { parseOptions } from "@/lib/domain/mealOptions";
import { useState } from "react";
import { Pencil, Plus, Send, Utensils } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { DocImportSection } from "./docimport/DocImportSection";
import { GatedAction } from "./GatedAction";
import { NutritionPlanEditor } from "./NutritionPlanEditor";
import { SendToPatientDialog } from "./SendToPatientDialog";
import { Card, CardContent } from "@/components/ui/card";
import { useNutritionPlan } from "@/hooks/usePlans";
import { useDisciplinePermissions } from "@/hooks/useDisciplines";
import { useCurrentProfessional, useCurrentProfessionalName } from "@/hooks/useCurrentProfessional";
import { canSendKind, SEND_DENIED_REASON } from "@/lib/domain/deliveries";
import { DISCIPLINE_REASON } from "@/lib/domain/disciplines";
import { formatNumber } from "@/lib/domain/format";
import type { PatientDetail } from "@/types/db";

export function NutritionTab({ patient }: { patient: PatientDetail }) {
  const { data, isLoading, isError, refetch } = useNutritionPlan(patient.id);
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const { perms } = useDisciplinePermissions();
  const { data: professional } = useCurrentProfessional();
  const { data: myName } = useCurrentProfessionalName();
  const canEdit = perms.canEditNutrition;

  const totalKcal = data?.meals.reduce((sum, m) => sum + (m.calories ?? 0), 0) ?? 0;

  return (
    <>
      <div className="mb-4">
        <DocImportSection patient={patient} kind="dieta" />
      </div>
      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        isEmpty={!data}
        onRetry={() => refetch()}
        emptyIcon={Utensils}
        emptyTitle="Nenhum plano alimentar"
        emptyDescription="Crie um plano alimentar para o paciente seguir no app."
        emptyAction={
          <GatedAction
            canEdit={canEdit}
            reason={DISCIPLINE_REASON.nutrition}
            wrapperClassName="items-center"
            onClick={() => setEditing(true)}
          >
            <Plus className="h-4 w-4" />
            Criar plano
          </GatedAction>
        }
      >
        {data ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-lg font-semibold text-foreground">{data.title}</h2>
                <span className="text-sm text-muted-foreground">{formatNumber(totalKcal, 1)} kcal/dia</span>
              </div>
              <div className="flex flex-wrap items-start justify-end gap-2">
                <GatedAction
                  canEdit={canSendKind("plano_alimentar", perms, Boolean(professional?.id))}
                  reason={SEND_DENIED_REASON.plano_alimentar}
                  wrapperClassName="items-end"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setSending(true)}
                >
                  <Send className="h-4 w-4" />
                  Enviar ao paciente
                </GatedAction>
                <GatedAction
                  canEdit={canEdit}
                  reason={DISCIPLINE_REASON.nutrition}
                  wrapperClassName="items-end"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-4 w-4" />
                  Editar
                </GatedAction>
              </div>
            </div>

          <div className="space-y-3">
            {data.meals.map((meal) => (
              <Card key={meal.id}>
                <CardContent className="flex items-start justify-between gap-4 p-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {meal.time ? (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          {meal.time}
                        </span>
                      ) : null}
                      <h3 className="font-medium text-foreground">{meal.name ?? "Refeição"}</h3>
                    </div>
                    {meal.items && meal.items.length > 0 ? (
                      <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
                        {meal.items.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                    {parseOptions(meal.options).length > 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground" data-testid="meal-options-count">
                        + {parseOptions(meal.options).length} {parseOptions(meal.options).length === 1 ? "opção de troca" : "opções de troca"}
                      </p>
                    ) : null}
                  </div>
                  {meal.calories != null ? (
                    <span className="shrink-0 text-sm font-medium text-foreground">{formatNumber(Number(meal.calories), 1)} kcal</span>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
      </AsyncSection>

      {data ? (
        <SendToPatientDialog
          open={sending}
          onOpenChange={setSending}
          kind="plano_alimentar"
          patientId={patient.id}
          patientName={patient.profile?.full_name ?? "Paciente"}
          professionalId={professional?.id ?? null}
          planTitle={data.title}
          build={async () => {
            const { buildNutritionPdf } = await import("@/lib/pdf/generatePlanPdf");
            return buildNutritionPdf(data, { patientName: patient.profile?.full_name ?? "Paciente", professionalName: myName ?? null });
          }}
        />
      ) : null}

      <NutritionPlanEditor
        patient={patient}
        existing={data ?? null}
        open={editing}
        onOpenChange={setEditing}
      />
    </>
  );
}
