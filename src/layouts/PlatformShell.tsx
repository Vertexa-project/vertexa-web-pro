import { Suspense } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";

import { Brand } from "@/components/Brand";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-context";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import { usePlatformOnboardingSettings } from "@/hooks/usePlatformOnboarding";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/platform", label: "Dashboard", end: true },
  { to: "/platform/solicitacoes", label: "Solicitações", end: false },
  { to: "/platform/clinicas", label: "Clínicas", end: false },
  { to: "/platform/configuracoes", label: "Configurações", end: false },
] as const;

/**
 * Chrome da área global. Presentacional + logout da sessão existente.
 * NÃO reutiliza Sidebar/Topbar clínicos, SOS, mentions nem clinic context.
 */
export function PlatformShell() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const access = useAmIPlatformAdmin(true);
  const settings = usePlatformOnboardingSettings(access.isPlatformAdmin === true);
  const pending = settings.data?.pendingRequestCount ?? 0;

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-8">
        <Brand markClassName="h-8 w-8" wordmarkClassName="text-lg" />
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          Plataforma
        </span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void handleSignOut()}>
          <LogOut className="h-4 w-4" aria-hidden />
          Sair
        </Button>
      </header>
      <nav
        aria-label="Área da plataforma"
        className="border-b border-border/70 bg-background px-4 md:px-8"
      >
        <ul className="mx-auto flex w-full max-w-7xl gap-1 overflow-x-auto py-2">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                }
              >
                {item.label}
                {item.to === "/platform/solicitacoes" && pending > 0 ? (
                  <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                    {pending > 99 ? "99+" : pending}
                  </span>
                ) : null}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
          <Suspense fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
