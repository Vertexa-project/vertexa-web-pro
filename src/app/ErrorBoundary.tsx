import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { captureException } from "@/lib/observability/sentry";

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * ErrorBoundary global: captura qualquer throw em tempo de RENDER em qualquer tela
 * (ex.: leitura de dado inesperado) e mostra uma tela amigável com ação de recarregar,
 * em vez de deixar a aplicação em tela branca. Em DEV, loga o erro completo.
 *
 * Limite conhecido: NÃO captura erros lançados durante a avaliação de módulos no boot
 * (ex.: env ausente em lib/supabase.ts). Esse caso é tratado por gate no main.tsx.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Reporta ao Sentry (no-op sem DSN). O evento passa por scrubbing antes do envio; o
    // component stack são nomes de componente (sem PII). Não anexar dado de paciente.
    captureException(error, {
      source: "error-boundary",
      componentStack: info.componentStack ?? undefined,
    });
    // Dados de saúde: em produção NÃO logar conteúdo sensível. Em DEV, logar para depurar.
    if (import.meta.env.DEV) {
      console.error("[VERTEXA] Erro não tratado na UI:", error, info.componentStack);
    }
  }

  private handleReload = () => {
    // Recarrega a MESMA rota (preserva o contexto do profissional), coerente com o rótulo do botão.
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-7 w-7" aria-hidden />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-foreground">Algo deu errado</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Encontramos um problema ao exibir esta tela. Você pode recarregar e tentar de novo.
            Se persistir, avise o suporte.
          </p>
        </div>
        {import.meta.env.DEV ? (
          <pre className="max-w-xl overflow-auto rounded-md border border-border bg-card px-4 py-3 text-left text-xs text-muted-foreground">
            {error.message}
          </pre>
        ) : null}
        <Button onClick={this.handleReload}>Recarregar página</Button>
      </div>
    );
  }
}
