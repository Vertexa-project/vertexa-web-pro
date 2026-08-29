import { Suspense } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";

import { Brand } from "@/components/Brand";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-context";

/**
 * Chrome da área global. Presentacional + logout da sessão existente.
 * NÃO reutiliza Sidebar/Topbar clínicos, SOS, mentions nem clinic context.
 */
export function PlatformShell() {
  const { signOut } = useAuth();
  const navigate = useNavigate();

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
