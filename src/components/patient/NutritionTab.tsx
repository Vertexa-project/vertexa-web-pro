import { useState } from "react";
import { Pencil, Plus, Utensils } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { NutritionPlanEditor } from "./NutritionPlanEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useNutritionPlan } from "@/hooks/usePlans";
import type { PatientDetail } from "@/types/db";

export function NutritionTab({ patient }: { patient: PatientDetail }) {
  const { data, isLoading, isError, refetch } = useNutritionPlan(patient.id);
  const [editing, setEditing] = useState(false);

  const totalKcal = data?.meals.reduce((sum, m) => sum + (m.calories ?? 0), 0) ?? 0;

  return (
    <>
      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        isEmpty={!data}
        onRetry={() => refetch()}
        emptyIcon={Utensils}
        emptyTitle="Nenhum plano alimentar"
        emptyDescription="Crie um plano alimentar para o paciente seguir no app."
        emptyAction={
          <Button onClick={() => setEditing(true)}>
            <Plus className="h-4 w-4" />
            Criar plano
          </Button>
        }
      >
        {data ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{data.title}</h2>
                <span className="text-sm text-muted-foreground">{totalKcal} kcal/dia</span>
              </div>
              <Button variant="outline" className="shrink-0" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" />
                Editar
              </Button>
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
                  </div>
                  {meal.calories != null ? (
                    <span className="shrink-0 text-sm font-medium text-foreground">{meal.calories} kcal</span>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
      </AsyncSection>

      <NutritionPlanEditor
        patient={patient}
        existing={data ?? null}
        open={editing}
        onOpenChange={setEditing}
      />
    </>
  );
}
