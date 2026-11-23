import { Suspense, useEffect } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Lock, LogOut } from "lucide-react";

import { BrandMark } from "@/components/Brand";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Button } from "@/components/ui/button";
import { useHelpCenterAccess } from "@/hooks/useHelpCenter";
import { clearHelpReturn, rememberHelpReturn } from "@/lib/help/returnTo";
import { cn } from "@/lib/utils";
import { PASSWORD_RESET_PATH } from "@/lib/auth/passwordRecovery";
import { useAuth } from "@/providers/auth-context";

const NAV = [{ to: "/ajuda", label: "Tutoriais", end: false }] as const;

function HelpHeader({ showNav }: { showNav: boolean }) {
  return (
    <header className="border-b border-border/70 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-3 px-4 md:px-6">
        <Link to="/ajuda" className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <BrandMark className="h-8 w-8" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">Vertexa</span>
            <span className="truncate text-xs text-muted-foreground">Central de Ajuda</span>
          </span>
        </Link>
        {showNav ? (
          <nav aria-label="Central de Ajuda" className="ml-2 hidden sm:block">
            <ul className="flex gap-1">
              {NAV.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                        isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <Button asChild variant="outline" size="sm" className="ml-auto shrink-0">
          <Link to="/access">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Voltar ao Vertexa</span>
            <span className="sm:hidden">Vertexa</span>
          </Link>
        </Button>
      </div>
    </header>
  );
}

function HelpNotSubscribed() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Lock className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">A Central de Ajuda é para clínicas que assinam o Vertexa</h1>
      <p className="mt-3 text-muted-foreground">
        Assim que a assinatura da sua clínica estiver ativa, os tutoriais e o suporte ficam liberados aqui, com o mesmo
        login do Vertexa.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link to="/access">Voltar ao Vertexa</Link>
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            await signOut();
            navigate("/login", { replace: true });
          }}
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sair
        </Button>
      </div>
    </div>
  );
}

function HelpAccessError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Não conseguimos abrir a Central de Ajuda agora</h1>
      <p className="mt-2 text-muted-foreground">Verifique sua internet e tente de novo.</p>
      <Button className="mt-5" onClick={onRetry}>
        Tentar de novo
      </Button>
    </div>
  );
}

/**
 * Site de tutoriais e suporte (cartão 1317). Fora do AppShell da clínica: layout próprio.
 * Entra quem assina (mesma regra comercial que libera o sistema) e a equipe da plataforma;
 * o servidor confere de novo em cada leitura.
 */
export function HelpLayout() {
  const { isAuthenticated, loading, isPasswordRecovery } = useAuth();
  const location = useLocation();
  const access = useHelpCenterAccess(isAuthenticated);
  const allowed = isAuthenticated && access.data?.allowed === true;

  useEffect(() => {
    if (allowed) clearHelpReturn();
  }, [allowed]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingState />
      </div>
    );
  }
  if (isPasswordRecovery) return <Navigate to={PASSWORD_RESET_PATH} replace />;
  if (!isAuthenticated) {
    rememberHelpReturn(location.pathname);
    return <Navigate to="/login" replace />;
  }

  let content: React.ReactNode;
  if (access.isLoading) {
    content = (
      <div className="flex flex-1 items-center justify-center py-24">
        <LoadingState />
      </div>
    );
  } else if (access.isError) {
    content = <HelpAccessError onRetry={() => void access.refetch()} />;
  } else if (!allowed) {
    content = <HelpNotSubscribed />;
  } else {
    content = (
      <main className="flex-1">
        <Suspense
          fallback={
            <div className="flex justify-center py-24">
              <LoadingState />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <HelpHeader showNav={allowed} />
      {content}
      <footer className="border-t border-border/70 bg-background">
        <div className="mx-auto w-full max-w-5xl px-4 py-5 text-xs text-muted-foreground md:px-6">
          Vertexa · Central de Ajuda para clínicas assinantes
        </div>
      </footer>
    </div>
  );
}
