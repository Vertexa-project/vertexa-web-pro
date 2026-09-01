import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ErrorState } from "@/components/feedback/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import {
  usePlatformOnboardingSettings,
  useSetClinicOnboardingPolicy,
} from "@/hooks/usePlatformOnboarding";
import {
  CLINIC_ONBOARDING_MODE_HELP,
  CLINIC_ONBOARDING_MODE_LABEL,
  onboardingErrorMessage,
  type ClinicOnboardingMode,
} from "@/lib/domain/clinicOnboarding";
import { formatDate } from "@/lib/domain/format";

const MODES: ClinicOnboardingMode[] = ["automatic", "manual_review", "closed"];

export function PlatformSettingsPage() {
  const access = useAmIPlatformAdmin(true);
  const settings = usePlatformOnboardingSettings(access.isPlatformAdmin === true);
  const save = useSetClinicOnboardingPolicy();
  const [draft, setDraft] = useState<ClinicOnboardingMode | null>(null);

  useEffect(() => {
    if (settings.data) setDraft(settings.data.mode);
  }, [settings.data]);

  const current = settings.data?.mode ?? "closed";
  const selected = draft ?? current;
  const dirty = selected !== current;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações"
        description="Política global de entrada de novas clínicas."
      />

      {settings.isLoading ? <Skeleton className="h-64 w-full" /> : null}

      {settings.isError ? (
        <ErrorState
          title="Não foi possível carregar as configurações"
          description="A política vive no banco. Sem fallback de ambiente."
          onRetry={() => void settings.refetch()}
        />
      ) : null}

      {!settings.isLoading && !settings.isError && settings.data ? (
        <Card>
          <CardHeader>
            <CardTitle>Entrada de novas clínicas</CardTitle>
            <CardDescription>
              Modo atual: {CLINIC_ONBOARDING_MODE_LABEL[current]}.
              {settings.data.updatedAt ? ` Última alteração em ${formatDate(settings.data.updatedAt)}.` : ""}
              {settings.data.updatedByName ? ` Por ${settings.data.updatedByName}.` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset className="space-y-3">
              <legend className="sr-only">Modo de entrada de novas clínicas</legend>
              {MODES.map((mode) => (
                <label
                  key={mode}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <input
                    type="radio"
                    name="clinic-onboarding-mode"
                    value={mode}
                    checked={selected === mode}
                    onChange={() => setDraft(mode)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium text-foreground">
                      {CLINIC_ONBOARDING_MODE_LABEL[mode]}
                    </span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">
                      {CLINIC_ONBOARDING_MODE_HELP[mode]}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            {save.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {onboardingErrorMessage(save.error)}
              </p>
            ) : null}
            {save.isSuccess && !dirty ? (
              <p role="status" className="text-sm text-muted-foreground">
                Política salva.
              </p>
            ) : null}
            <Button
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate(selected)}
            >
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar política
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
