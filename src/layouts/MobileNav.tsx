import { useState } from "react";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { footerNav, mainNav } from "@/app/routes";
import { useUnreadMentions } from "@/hooks/useChat";
import { NavRow } from "./NavRow";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { data: mentions } = useUnreadMentions();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu de navegação">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72">
        <SheetTitle className="sr-only">Navegação</SheetTitle>
        <SheetDescription className="sr-only">Menu principal do VERTEXA</SheetDescription>

        <div className="flex h-16 items-center gap-2 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="text-sm font-bold">V</span>
          </div>
          <span className="text-lg font-semibold tracking-tight text-foreground">VERTEXA</span>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {mainNav.map((item) => (
            <NavRow
              key={item.path}
              item={item}
              onNavigate={close}
              badgeCount={item.path === "/mensagens" ? mentions?.total : undefined}
            />
          ))}
        </nav>

        <div className="space-y-1 border-t border-sidebar-border px-3 py-3">
          {footerNav.map((item) => (
            <NavRow key={item.path} item={item} onNavigate={close} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
