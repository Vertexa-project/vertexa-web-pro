import { useNavigate } from "react-router-dom";
import { CreditCard, LogOut, MessageCircle, Moon, Settings, Sun } from "lucide-react";

import { ProfilePhoto } from "@/components/avatar/ProfilePhoto";
import { ClinicIdentity } from "@/components/ClinicIdentity";
import { StaffNotificationsBell } from "@/components/notifications/StaffNotificationsBell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MobileNav } from "./MobileNav";
import { useIdentity } from "@/hooks/useIdentity";
import { useMyProfileAvatar } from "@/hooks/useProfileAvatar";
import { useAuth } from "@/providers/auth-context";
import { useRole } from "@/providers/role-context";
import { useTheme } from "@/providers/theme-context";

export function Topbar() {
  const navigate = useNavigate();
  const { signOut, session } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { roleLabel } = useRole();
  const identity = useIdentity();
  const myAvatar = useMyProfileAvatar(identity.actingProfileId);

  const userName =
    identity.status === "active"
      ? identity.displayName ?? "Profissional"
      : session?.user?.email ?? "Profissional";

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-4 md:px-[22px]">
      <MobileNav />

      {/* Marca só no mobile (no desktop ela vive na sidebar). */}
      <div className="md:hidden">
        <ClinicIdentity compact markClassName="h-8 w-8" />
      </div>

      {/* Busca global fica oculta até funcionar (redesign P1 · item 7). */}

      <div className="ml-auto flex items-center gap-1">
        <StaffNotificationsBell />
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          aria-label="WhatsApp (em breve)"
          title="WhatsApp (em breve)"
        >
          <MessageCircle className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label="Alternar tema"
          title="Alternar tema"
        >
          {resolvedTheme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="ml-1 gap-2 px-2" aria-label={`Conta · papel ${roleLabel}`}>
              <ProfilePhoto
                name={userName}
                avatarPath={myAvatar.data?.avatar_path ?? null}
                legacyUrl={myAvatar.data?.avatar_url ?? null}
              />
              <span className="hidden flex-col items-start leading-tight sm:flex">
                <span className="max-w-[12rem] truncate text-sm font-medium">{userName}</span>
                <span className="text-xs text-muted-foreground">{roleLabel}</span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Minha conta</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/configuracoes")}>
              <Settings />
              Configurações
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/configuracoes")}>
              <CreditCard />
              Assinatura
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggleTheme}>
              {resolvedTheme === "dark" ? <Sun /> : <Moon />}
              Modo {resolvedTheme === "dark" ? "claro" : "escuro"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
              <LogOut />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
