import { NavLink } from "react-router-dom";

import type { NavItem } from "@/app/routes";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface NavRowProps {
  item: NavItem;
  onNavigate?: () => void;
  /** Contador opcional (ex.: menções não lidas) exibido como badge à direita. */
  badgeCount?: number;
}

export function NavRow({ item, onNavigate, badgeCount }: NavRowProps) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Barra indicadora laranja do item ativo */}
          <span
            className={cn(
              "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
              isActive ? "opacity-100" : "opacity-0",
            )}
            aria-hidden
          />
          <Icon className={cn("h-[18px] w-[18px] shrink-0", isActive && "text-primary")} aria-hidden />
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
        </>
      )}
    </NavLink>
  );
}
