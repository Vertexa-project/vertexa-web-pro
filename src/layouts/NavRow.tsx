import { NavLink, useLocation } from "react-router-dom";
import { Lock } from "lucide-react";

import { isNavActive, type NavItem } from "@/app/routes";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface NavRowProps {
  item: NavItem;
  onNavigate?: () => void;
  /** Contador opcional (ex.: menções não lidas) exibido como badge à direita. */
  badgeCount?: number;
}

const baseRow =
  "group relative flex items-center gap-3 rounded-[10px] px-[11px] py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function Spine({ active }: { active: boolean }) {
  // Barra indicadora laranja do item ativo — a assinatura estrutural da marca.
  return (
    <span
      className={cn(
        "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-brand transition-opacity",
        active ? "opacity-100" : "opacity-0",
      )}
      aria-hidden
    />
  );
}

export function NavRow({ item, onNavigate, badgeCount }: NavRowProps) {
  const Icon = item.icon;
  const { pathname } = useLocation();
  // Ativo pela rota do item OU pelas rotas antigas agrupadas nele (ex.: /mensagens → Relacionamento).
  const active = isNavActive(item, pathname);

  // Item de roadmap (cadeado): não navega, apenas sinaliza o que vem.
  // Não-interativo (sem role/tabindex de link); o cadeado + sr-only comunicam o estado.
  if (item.locked) {
    return (
      <div className={cn(baseRow, "cursor-default text-muted-foreground")} title="Em breve">
        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
        <span>{item.label}</span>
        <Lock className="ml-auto h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
        <span className="sr-only">(em breve)</span>
      </div>
    );
  }

  return (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        baseRow,
        active
          ? "bg-accent font-semibold text-primary-ink"
          : "font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      <Spine active={active} />
      <Icon
        className={cn(
          "h-[18px] w-[18px] shrink-0 transition-colors",
          active ? "text-primary-ink" : "text-muted-foreground group-hover:text-foreground",
        )}
        aria-hidden
      />
      <span>{item.label}</span>
      {badgeCount && badgeCount > 0 ? (
        <Badge
          tone="primary"
          className="ml-auto h-5 min-w-5 justify-center px-1.5 tabular-nums"
          aria-label={`${badgeCount} não lidas`}
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </Badge>
      ) : null}
    </NavLink>
  );
}
