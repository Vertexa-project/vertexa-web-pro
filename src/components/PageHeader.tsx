import * as React from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

/** Cabeçalho de página: título + subtítulo + ações à direita. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="flex items-start gap-3">
        {/* Spine laranja — assinatura estrutural (ecoa a barra do item de menu ativo). */}
        <span className="mt-1 h-8 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
