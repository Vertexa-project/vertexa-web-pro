import { ErrorState } from "@/components/feedback/ErrorState";

/**
 * Fail-closed da resolução comercial em ENFORCE: não monta o produto clínico
 * quando o resolver falha de forma inesperada. Não é tela de PRE_CONTRACT.
 */
export function CommercialAccessError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div
      className="flex h-screen items-center justify-center bg-background px-6"
      data-testid="commercial-access-error"
    >
      <ErrorState
        title="Não foi possível verificar o acesso comercial"
        description="Não foi possível confirmar se esta clínica pode usar o produto agora. Tente novamente. O painel clínico não será aberto até essa confirmação."
        onRetry={onRetry}
      />
    </div>
  );
}
