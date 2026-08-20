import { useNavigate } from "react-router-dom";
import { CreditCard, LogOut, MessageCircle, Moon, Search, Settings, Sun } from "lucide-react";

import { BrandMark } from "@/components/Brand";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useAuth } from "@/providers/auth-context";
import { useRole } from "@/providers/role-context";
import { useTheme } from "@/providers/theme-context";

function getInitials(label: string): string {
  const parts = label.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return label.split("@")[0].slice(0, 2).toUpperCase();
}

export function Topbar() {
  const navigate = useNavigate();
  const { signOut, session } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { roleLabel } = useRole();
  const identity = useIdentity();

  const userName =
    identity.status === "active"
      ? identity.displayName ?? "Profissional"
      : session?.user?.email ?? "Profissional";
  const initials = getInitials(userName);

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border/70 bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-6">
      <MobileNav />

      {/* Marca só no mobile (no desktop ela vive na sidebar). */}
      <div className="md:hidden">
        <BrandMark className="h-8 w-8" />
      </div>

      <div className="relative hidden max-w-xs flex-1 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          placeholder="Buscar (em breve)"
          className="bg-muted/50 pl-9"
          aria-label="Busca global (em breve)"
          title="Busca global (em breve)"
          disabled
        />
      </div>

      <div className="ml-auto flex items-center gap-1">
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
              <Avatar>
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
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
