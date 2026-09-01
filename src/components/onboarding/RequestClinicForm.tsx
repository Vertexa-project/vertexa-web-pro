import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRequestClinicCreation } from "@/hooks/useRequestClinicCreation";
import { captureException } from "@/lib/observability/sentry";
import {
  CLINIC_NAME_MAX,
  isExpectedOnboardingError,
  onboardingErrorMessage,
  validateClinicName,
} from "@/lib/domain/clinicOnboarding";

export function RequestClinicForm({ defaultName = "" }: { defaultName?: string }) {
  const [name, setName] = useState(defaultName);
  const [formError, setFormError] = useState<string | null>(null);
  const request = useRequestClinicCreation();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const check = validateClinicName(name);
    if (!check.ok) {
      setFormError(check.message);
      return;
    }
    setFormError(null);
    request.mutate(check.value, {
      onError: (err) => {
        if (!isExpectedOnboardingError(err)) {
          captureException(err, { source: "onboarding", scope: "request-clinic" });
        }
      },
    });
  }

  const errorMessage = formError ?? (request.isError ? onboardingErrorMessage(request.error) : null);

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-left" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="request-clinic-name">
          Nome da clínica <span className="text-destructive">*</span>
        </Label>
        <Input
          id="request-clinic-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={CLINIC_NAME_MAX}
          placeholder="Ex.: Clínica Vida Ativa"
          aria-required="true"
          aria-invalid={Boolean(errorMessage)}
          aria-describedby={errorMessage ? "request-clinic-error" : undefined}
          disabled={request.isPending}
        />
      </div>
      {errorMessage ? (
        <p id="request-clinic-error" role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={request.isPending}>
        {request.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Enviando…
          </>
        ) : (
          "Solicitar criação da clínica"
        )}
      </Button>
    </form>
  );
}
