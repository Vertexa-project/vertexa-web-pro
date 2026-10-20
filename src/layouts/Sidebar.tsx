import { footerNav } from "@/app/routes";
import { useVisibleMainNav } from "@/hooks/useVisibleNav";
import { ClinicIdentity } from "@/components/ClinicIdentity";
import { useUnreadMentions } from "@/hooks/useChat";
import { NavRow } from "./NavRow";

export function Sidebar() {
  const { data: mentions } = useUnreadMentions();
  const visibleMainNav = useVisibleMainNav();
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-16 items-center px-5">
        <ClinicIdentity />
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2" aria-label="Navegação principal">
        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Menu
        </p>
        {visibleMainNav.map((item) => (
          <NavRow
            key={item.path}
            item={item}
            badgeCount={item.path === "/mensagens" ? mentions?.total : undefined}
          />
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-sidebar-border px-3 py-3">
        {footerNav.map((item) => (
          <NavRow key={item.path} item={item} />
        ))}
      </div>
    </aside>
  );
}
