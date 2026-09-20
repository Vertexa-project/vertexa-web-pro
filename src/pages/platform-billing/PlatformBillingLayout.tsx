import { NavLink, Outlet } from "react-router-dom";

import { cn } from "@/lib/utils";

const SUBNAV = [
  { to: "/platform/billing", label: "Visão geral", end: true },
  { to: "/platform/billing/contratos", label: "Contratos", end: false },
  { to: "/platform/billing/cobrancas", label: "Cobranças", end: false },
  { to: "/platform/billing/pagamentos", label: "Pagamentos", end: false },
  { to: "/platform/billing/inadimplencia", label: "Inadimplência", end: false },
  { to: "/platform/billing/pix", label: "Pix Automático", end: false },
  { to: "/platform/billing/eventos", label: "Eventos", end: false },
  { to: "/platform/billing/relatorios", label: "Relatórios", end: false },
] as const;

export function PlatformBillingLayout() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Faturamento da plataforma</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Quem precisa de atenção, por quê, e o que aconteceu. A inadimplência vem de cobrança
          vencida — Pix recusado não é atraso financeiro.
        </p>
      </div>
      <nav
        aria-label="Faturamento da plataforma"
        className="border-y border-border/70 bg-background"
      >
        <ul className="flex gap-1 overflow-x-auto py-2">
          {SUBNAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "inline-flex whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium",
                    isActive
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
