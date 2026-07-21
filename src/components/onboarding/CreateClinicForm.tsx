import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateOwnClinic } from "@/hooks/useCreateOwnClinic";
import { captureException } from "@/lib/observability/sentry";
import {
  CLINIC_NAME_MAX,
  isExpectedOnboardingError,
  onboardingErrorMessage,
  validateClinicName,
} from "@/lib/domain/clinicOnboarding";

/**
 * Formulário mínimo de criação da PRÓPRIA clínica (na tela de acesso pendente). Fluxo:
 *   nome → valida (mesmas regras do banco) → RPC create_clinic_with_owner → confirmação + próximos
 *   passos → "Ir para o painel" (recarrega a identidade ⇒ entra como administradora).
 * Erros da RPC viram mensagem compreensível (por `hint`); só o INESPERADO vai ao Sentry
 * (source:"onboarding", sem PII — nunca o nome da clínica).
 */
export function CreateClinicForm() {
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const create = useCreateOwnClinic();
  const qc = useQueryClient();
  const navigate = useNavigate();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const check = validateClinicName(name);
    if (!check.ok) {
      setFormError(check.message);
      return;
    }
    setFormError(null);
    create.mutate(check.value, {
      onSuccess: () => setCreated(true),
      onError: (err) => {
        // Erros esperados (validação/guarda-corpo) só viram mensagem; o inesperado vai ao Sentry.
        if (!isExpectedOnboardingError(err)) {
          captureException(err, { source: "onboarding", scope: "create-clinic" });
        }
      },
    });
  }

  function enterPanel() {
    // Recarrega a identidade (profile + professional) e o sinal de admin. Sem isto a app ficaria presa
    // na tela de pendência — essas queries têm staleTime Infinity. Invalidação por PREFIXO cobre a chave
    // exata de cada usuário. A autoridade real (admin) já está no banco (posse/clinic_role).
    qc.invalidateQueries({ queryKey: ["profileByAuthUser"] });
    qc.invalidateQueries({ queryKey: ["currentProfessional"] });
    qc.invalidateQueries({ queryKey: ["clinicAdmin"] });
    navigate("/", { replace: true });
  }

  if (created) {
    return (
      <div className="space-y-4 text-left">
        <div className="flex items-center gap-2 text-foreground">
          <Building2 className="h-5 w-5 text-primary" aria-hidden />
          <h2 className="text-base font-semibold">Clínica criada!</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Você agora é a administradora da sua clínica. Próximos passos, já dentro do painel:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Cadastre seu primeiro paciente em <span className="font-medium text-foreground">Pacientes</span>.
          </li>
          <li>
            Monte sua equipe e atribua disciplinas em{" "}
            <span className="font-medium text-foreground">Configurações → Disciplinas</span>.
          </li>
        </ul>
        <Button onClick={enterPanel} className="w-full">
          Ir para o painel
        </Button>
      </div>
    );
  }

  const errorMessage = formError ?? (create.isError ? onboardingErrorMessage(create.error) : null);

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-left" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="clinic-name">
          Nome da clínica <span className="text-destructive">*</span>
        </Label>
        <Input
          id="clinic-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={CLINIC_NAME_MAX}
          placeholder="Ex.: Clínica Vida Ativa"
          autoFocus
          aria-required="true"
          aria-invalid={Boolean(errorMessage)}
          aria-describedby={errorMessage ? "clinic-form-error" : undefined}
          disabled={create.isPending}
        />
      </div>
      {errorMessage ? (
        <p id="clinic-form-error" role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={create.isPending}>
        {create.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Criando…
          </>
        ) : (
          "Criar minha clínica"
        )}
      </Button>
    </form>
  );
}
