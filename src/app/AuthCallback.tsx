import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/feedback/LoadingState";
import { captureException } from "@/lib/observability/sentry";
import { supabase } from "@/lib/supabase";

/**
 * Rota de retorno do OAuth (Google). O client Supabase (detectSessionInUrl = default true)
 * troca o `?code=` por sessão automaticamente; aqui só confirmamos e redirecionamos. Erros do
 * provedor (`?error=`) e falhas de sessão são reportados ao Sentry (source:"auth", sem PII).
 */
export function AuthCallback() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    const params = new URLSearchParams(window.location.search);
    const providerError = params.get("error_description") || params.get("error");
    if (providerError) {
      // Não logar o e-mail/estado — só a razão do provedor.
      captureException(new Error(`OAuth callback error: ${params.get("error") ?? "unknown"}`), {
        source: "auth",
        scope: "callback",
      });
      setFailed(true);
      return;
    }

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        captureException(error, { source: "auth", scope: "callback" });
        setFailed(true);
        return;
      }
      navigate(data.session ? "/" : "/login", { replace: true });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (next && active) navigate("/", { replace: true });
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  if (failed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-7 w-7" aria-hidden />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-foreground">Não foi possível concluir o login</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Houve um problema ao retornar do provedor. Tente novamente.
          </p>
        </div>
        <Button onClick={() => navigate("/login", { replace: true })}>Voltar para o login</Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <LoadingState />
    </div>
  );
}
