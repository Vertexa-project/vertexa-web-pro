import { Link, useLocation } from "react-router-dom";

import { activeSectionTab, type SectionTab } from "@/lib/domain/gestaoNav";
import { cn } from "@/lib/utils";

/**
 * Sub-abas de uma seção do menu (Gestão, Relacionamento). Cada aba é um link para uma rota que já existia; no celular
 * a lista rola na horizontal dentro da própria barra (sem empurrar a página).
 */
export function SectionTabs({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  const { pathname } = useLocation();
  const active = activeSectionTab(tabs, pathname);
  if (tabs.length === 0) return null;
  return (
    <nav aria-label={label} className="min-w-0 max-w-full overflow-x-auto border-b border-border">
      <ul className="flex w-max min-w-full gap-1">
        {tabs.map((t) => {
          const on = active?.to === t.to;
          return (
            <li key={t.to}>
              <Link
                to={t.to}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "-mb-px block whitespace-nowrap border-b-2 px-[13px] py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  on
                    ? "border-brand font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
