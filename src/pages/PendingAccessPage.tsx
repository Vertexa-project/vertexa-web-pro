import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Building2, KeyRound } from "lucide-react";

import { Brand } from "@/components/Brand";
import { CreateClinicForm } from "@/components/onboarding/CreateClinicForm";
import { JoinClinicForm } from "@/components/onboarding/JoinClinicForm";
import { RequestClinicForm } from "@/components/onboarding/RequestClinicForm";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/providers/auth-context";
import { useMyJoinRequests } from "@/hooks/useClinicJoin";
import { useClinicOnboardingState } from "@/hooks/useClinicOnboardingState";
import { useIdentity } from "@/hooks/useIdentity";
import {
  onboardingErrorHint,
  onboardingErrorMessage,
  resolveCreateClinicSurface,
  type CreateClinicSurface,
} from "@/lib/domain/clinicOnboarding";

type Step = "choose" | "clinic" | "join";

function isClinicStatusSurface(surface: CreateClinicSurface | null): boolean {
  return surface === "pending" || surface === "approved" || surface === "rejected" || surface === "expired";
}

const stepHeadingClass = "font-display text-lg font-semibold tracking-tight outline-none";

function SituationChoice({
  title,
  description,
  cta,
  icon,
  onSelect,
}: {
  title: string;
  description: string;
  cta: string;
  icon: ReactNode;
  onSelect: () => void;
}) {
  return (
    <article className="flex flex-col rounded-2xl border border-border/80 bg-card p-6 shadow-card">
      <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </div>
      <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
      <Button type="button" className="mt-6 w-full" onClick={onSelect}>
        {cta}
      </Button>
    </article>
  );
}

function ClinicOnboardingPanel({
  onBack,
  headingRef,
}: {
  onBack: () => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const state = useClinicOnboardingState(true);

  if (state.isLoading) {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <BackButton onBack={onBack} />
          <h2 ref={headingRef} tabIndex={-1} className={`${stepHeadingClass} flex items-center gap-2`}>
            <Building2 className="h-5 w-5 text-primary" aria-hidden />
            Clínica
          </h2>
        </CardHeader>
        <CardContent className="space-y-3" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando política de cadastro</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (state.isError) {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader>
          <BackButton onBack={onBack} />
          <h2 ref={headingRef} tabIndex={-1} className={`${stepHeadingClass} flex items-center gap-2`}>
            <Building2 className="h-5 w-5 text-primary" aria-hidden />
            Clínica
          </h2>
        </CardHeader>
        <CardContent>
          <ErrorState
            title="Não foi possível verificar a política de entrada"
            description={
              onboardingErrorHint(state.error)
                ? onboardingErrorMessage(state.error)
                : "Tente novamente. Não assumimos que você está sem equipe."
            }
            onRetry={() => void state.refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  const surface = resolveCreateClinicSurface(state.data?.mode ?? "closed", state.data?.request ?? null);
  const request = state.data?.request ?? null;

  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="space-y-3">
        <BackButton onBack={onBack} />
        <ClinicPanelHeader surface={surface} headingRef={headingRef} />
      </CardHeader>
      <CardContent>
        <ClinicPanelBody surface={surface} requestName={request?.requestedClinicName ?? ""} rejectionReason={request?.rejectionReason} />
      </CardContent>
    </Card>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Voltar
    </Button>
  );
}

function ClinicPanelHeader({
  surface,
  headingRef,
}: {
  surface: CreateClinicSurface;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  if (surface === "closed") {
    return (
      <>
        <h2 ref={headingRef} tabIndex={-1} className={stepHeadingClass}>
          Novos cadastros estão temporariamente fechados
        </h2>
        <CardDescription>
          No momento, a Vertexa não está recebendo novos cadastros de clínicas.
        </CardDescription>
      </>
    );
  }
  if (surface === "pending") {
    return (
      <>
        <h2 ref={headingRef} tabIndex={-1} className={stepHeadingClass}>Solicitação enviada</h2>
        <CardDescription>
          Seu cadastro está sendo analisado. Avisaremos aqui assim que ele for aprovado.
        </CardDescription>
      </>
    );
  }
  if (surface === "rejected") {
    return (
      <>
        <h2 ref={headingRef} tabIndex={-1} className={stepHeadingClass}>Cadastro não aprovado</h2>
        <CardDescription>Você pode enviar um novo pedido com outro nome, se quiser tentar de novo.</CardDescription>
      </>
    );
  }
  if (surface === "expired") {
    return (
      <>
        <h2 ref={headingRef} tabIndex={-1} className={stepHeadingClass}>Solicitar cadastro da clínica</h2>
        <CardDescription>
          O prazo da aprovação anterior acabou. Envie um novo pedido para análise.
        </CardDescription>
      </>
    );
  }
  if (surface === "request") {
    return (
      <>
        <h2 ref={headingRef} tabIndex={-1} className={stepHeadingClass}>Solicitar cadastro da clínica</h2>
        <CardDescription>
          Informe o nome da clínica. A equipe Vertexa analisará o cadastro antes da ativação.
        </CardDescription>
      </>
    );
  }
  if (surface === "approved") {
    return (
      <>
        <h2 ref={headingRef} tabIndex={-1} className={stepHeadingClass}>Cadastro aprovado</h2>
        <CardDescription>Sua clínica foi aprovada. Confirme para concluir o cadastro.</CardDescription>
      </>
    );
  }
  return (
    <>
      <h2 ref={headingRef} tabIndex={-1} className={stepHeadingClass}>Cadastrar minha clínica</h2>
      <CardDescription>Informe o nome da clínica para começar.</CardDescription>
    </>
  );
}

function ClinicPanelBody({
  surface,
  requestName,
  rejectionReason,
}: {
  surface: CreateClinicSurface;
  requestName: string;
  rejectionReason: string | null | undefined;
}) {
  if (surface === "closed") {
    return null;
  }
  if (surface === "pending") {
    return requestName ? (
      <p className="text-sm text-muted-foreground">
        Pedido para <span className="font-medium text-foreground">{requestName}</span>.
      </p>
    ) : null;
  }
  if (surface === "rejected") {
    return (
      <div className="space-y-4">
        {rejectionReason ? (
          <p className="text-sm text-muted-foreground">Motivo: {rejectionReason}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum detalhe adicional foi informado.</p>
        )}
        <RequestClinicForm defaultName={requestName} />
      </div>
    );
  }
  if (surface === "expired") {
    return (
      <div className="space-y-4">
        {requestName ? (
          <p className="text-sm text-muted-foreground">
            A aprovação de <span className="font-medium text-foreground">{requestName}</span> expirou.
          </p>
        ) : null}
        <RequestClinicForm defaultName={requestName} />
      </div>
    );
  }
  if (surface === "request") {
    return <RequestClinicForm />;
  }
  return (
    <CreateClinicForm
      defaultName={surface === "approved" ? requestName : ""}
      nameLocked={surface === "approved"}
      submitLabel={surface === "approved" ? "Concluir cadastro" : "Criar minha clínica"}
    />
  );
}

/**
 * Acesso pendente: sessão válida, sem profissional/clínica.
 * Primeiro a pessoa escolhe a situação; o formulário só aparece depois.
 */
export function PendingAccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signOut } = useAuth();
  const { email } = useIdentity();
  const state = useClinicOnboardingState(true);
  const mine = useMyJoinRequests();
  const inviteCode = Boolean(searchParams.get("code")?.trim());
  const pendingJoin = (mine.data ?? []).some((row) => row.status === "pending");
  const [step, setStep] = useState<Step>(inviteCode ? "join" : "choose");
  const [autoRouted, setAutoRouted] = useState(inviteCode);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const skipInitialChooseFocus = useRef(true);

  const surface = state.data
    ? resolveCreateClinicSurface(state.data.mode, state.data.request)
    : null;

  useEffect(() => {
    if (autoRouted) return;
    if (step !== "choose") return;
    if (isClinicStatusSurface(surface)) {
      setStep("clinic");
      setAutoRouted(true);
      return;
    }
    if (pendingJoin) {
      setStep("join");
      setAutoRouted(true);
    }
  }, [autoRouted, pendingJoin, step, surface]);

  useLayoutEffect(() => {
    if (skipInitialChooseFocus.current && step === "choose") {
      skipInitialChooseFocus.current = false;
      return;
    }
    skipInitialChooseFocus.current = false;
    if (step === "choose") {
      document.getElementById("onboarding-title")?.focus();
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step, surface]);

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  function goToChoose() {
    setStep("choose");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 py-10">
      <Brand markClassName="h-10 w-10" wordmarkClassName="text-xl" />

      <header className="max-w-lg space-y-2 text-center">
        <h1
          id="onboarding-title"
          tabIndex={-1}
          className="font-display text-2xl font-semibold tracking-tight text-foreground outline-none"
        >
          Vamos configurar seu acesso
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Você entrou
          {email ? (
            <>
              {" "}
              como <span className="font-medium text-foreground">{email}</span>
            </>
          ) : null}
          {step === "choose" ? ". Agora escolha como fará parte do Vertexa." : "."}
        </p>
      </header>

      {step === "choose" ? (
        <div
          data-testid="onboarding-choices"
          className="grid w-full max-w-3xl grid-cols-1 gap-4 md:grid-cols-2"
        >
          <SituationChoice
            title="Sou responsável por uma clínica"
            description="Quero cadastrar minha clínica e administrar minha equipe no Vertexa."
            cta="Cadastrar minha clínica"
            icon={<Building2 className="h-5 w-5" aria-hidden />}
            onSelect={() => setStep("clinic")}
          />
          <SituationChoice
            title="Fui convidado para uma clínica"
            description="Já existe uma clínica no Vertexa e recebi um código para entrar na equipe."
            cta="Entrar com código"
            icon={<KeyRound className="h-5 w-5" aria-hidden />}
            onSelect={() => setStep("join")}
          />
        </div>
      ) : null}

      {step === "clinic" ? (
        <ClinicOnboardingPanel onBack={goToChoose} headingRef={stepHeadingRef} />
      ) : null}

      {step === "join" ? (
        <Card className="w-full max-w-lg">
          <CardHeader className="space-y-3">
            <BackButton onBack={goToChoose} />
            <h2 ref={stepHeadingRef} tabIndex={-1} className={stepHeadingClass}>
              Entrar em uma clínica
            </h2>
            <CardDescription>Digite o código que você recebeu da clínica.</CardDescription>
          </CardHeader>
          <CardContent>
            <JoinClinicForm />
          </CardContent>
        </Card>
      ) : null}

      <Button type="button" variant="outline" onClick={() => void handleSignOut()}>
        Sair
      </Button>
    </div>
  );
}
