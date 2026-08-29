import type { ReactNode } from "react";

import { Brand } from "@/components/Brand";

/** Chrome mínimo das rotas auth-special — sem AppShell e sem PlatformShell. */
export function AuthSpecialLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <Brand markClassName="h-10 w-10" wordmarkClassName="text-xl" />
      <div className="mt-8 w-full max-w-sm space-y-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        {children}
      </div>
    </div>
  );
}
