import { footerNav, mainNav } from "@/app/routes";
import { NavRow } from "./NavRow";

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-16 items-center gap-2 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <span className="text-sm font-bold">V</span>
        </div>
        <span className="text-lg font-semibold tracking-tight text-foreground">VERTEXA</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {mainNav.map((item) => (
          <NavRow key={item.path} item={item} />
        ))}
      </nav>

      <div className="space-y-1 border-t border-sidebar-border px-3 py-3">
        {footerNav.map((item) => (
          <NavRow key={item.path} item={item} />
        ))}
      </div>
    </aside>
  );
}
