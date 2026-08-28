import { ErrorState } from "@/components/feedback/ErrorState";

/**
 * Fail-closed da verificação de Platform Admin: não monta o painel clínico, não monta
 * onboarding, não assume `false`.
 */
export function PlatformAuthorityError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div
      className="flex h-screen items-center justify-center bg-background px-6"
      data-testid="platform-authority-error"
    >
      <ErrorState
        title="Não foi possível verificar o acesso"
        description="Não foi possível confirmar a autoridade da plataforma. Tente novamente. O painel clínico não será aberto até essa confirmação."
        onRetry={onRetry}
      />
    </div>
  );
}
