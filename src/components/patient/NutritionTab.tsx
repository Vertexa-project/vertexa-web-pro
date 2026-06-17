import { Utensils } from "lucide-react";

import { AsyncSection } from "./AsyncSection";
import { Card, CardContent } from "@/components/ui/card";
import { useNutritionPlan } from "@/hooks/usePlans";

export function NutritionTab({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, refetch } = useNutritionPlan(patientId);

  const totalKcal = data?.meals.reduce((sum, m) => sum + (m.calories ?? 0), 0) ?? 0;

  return (
    <AsyncSection
      isLoading={isLoading}
      isError={isError}
      isEmpty={!data}
      onRetry={() => refetch()}
      emptyIcon={Utensils}
      emptyTitle="Nenhum plano alimentar"
      emptyDescription="Crie um plano alimentar para o paciente seguir no app."
    >
      {data ? (
        <div className="space-y-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-foreground">{data.title}</h2>
            <span className="text-sm text-muted-foreground">{totalKcal} kcal/dia</span>
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
  );
}
