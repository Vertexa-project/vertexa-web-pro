import { useNavigate } from "react-router-dom";
import { Building2, KeyRound } from "lucide-react";

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
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/providers/auth-context";
import { useClinicOnboardingState } from "@/hooks/useClinicOnboardingState";
import { useIdentity } from "@/hooks/useIdentity";
import { resolveCreateClinicSurface } from "@/lib/domain/clinicOnboarding";

function CreateClinicCard() {
  const state = useClinicOnboardingState(true);

  if (state.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" aria-hidden />
            Clínica
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (state.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" aria-hidden />
            Clínica
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorState
            title="Não foi possível verificar a política de entrada"
            description="Tente novamente. Não assumimos que você está sem equipe."
            onRetry={() => void state.refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  const surface = resolveCreateClinicSurface(state.data?.mode ?? "closed", state.data?.request ?? null);
  const request = state.data?.request ?? null;

  if (surface === "closed") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" aria-hidden />
            Criar minha clínica
          </CardTitle>
          <CardDescription>
            Novos cadastros de clínicas estão temporariamente indisponíveis.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (surface === "pending") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" aria-hidden />
            Solicitar criação da clínica
          </CardTitle>
          <CardDescription>Solicitação aguardando análise</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Pedido para{" "}
            <span className="font-medium text-foreground">{request?.requestedClinicName}</span>.
          </p>
          <p>Você recebe a liberação aqui quando a plataforma concluir a análise.</p>
        </CardContent>
      </Card>
    );
  }

  if (surface === "rejected") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" aria-hidden />
            Solicitar criação da clínica
          </CardTitle>
          <CardDescription>A solicitação anterior foi recusada.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {request?.rejectionReason ? (
            <p className="text-sm text-muted-foreground">Motivo: {request.rejectionReason}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Você pode enviar um novo pedido.</p>
          )}
          <RequestClinicForm defaultName={request?.requestedClinicName ?? ""} />
        </CardContent>
      </Card>
    );
  }

  if (surface === "request") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" aria-hidden />
            Solicitar criação da clínica
          </CardTitle>
          <CardDescription>
            Envie o nome da clínica. A plataforma analisa antes de liberar a criação.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RequestClinicForm />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" aria-hidden />
          Criar minha clínica
        </CardTitle>
        <CardDescription>
          {surface === "approved"
            ? "Sua solicitação foi aprovada. Confirme o nome e conclua a criação."
            : "Você é profissional e vai administrar a própria clínica. Crie agora e entre como administradora."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CreateClinicForm defaultName={surface === "approved" ? (request?.requestedClinicName ?? "") : ""} />
      </CardContent>
    </Card>
  );
}

/**
 * Acesso pendente: sessão válida, sem profissional/clínica.
 * Criar clínica agora respeita a política global (PLATFORM-01).
 * Entrar numa clínica existente (join code) é independente.
 */
export function PendingAccessPage() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { email } = useIdentity();

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 py-10">
      <Brand markClassName="h-10 w-10" wordmarkClassName="text-xl" />

      <div className="max-w-md space-y-1 text-center">
        <h1 className="text-lg font-semibold text-foreground">Falta um passo para começar</h1>
        <p className="text-sm text-muted-foreground">
          Seu login foi concluído
          {email ? (
            <>
              {" "}
              como <span className="font-medium text-foreground">{email}</span>
            </>
          ) : null}
          , mas sua conta ainda não está vinculada a uma clínica. Escolha como continuar:
        </p>
      </div>

      <div className="grid w-full max-w-3xl gap-4 md:grid-cols-2">
        <CreateClinicCard />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" aria-hidden />
              Entrar em uma clínica
            </CardTitle>
            <CardDescription>
              Você foi chamada(o) para a equipe de uma clínica. Informe o código que ela te passou.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <JoinClinicForm />
            <Button variant="outline" onClick={handleSignOut} className="w-full">
              Sair
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
