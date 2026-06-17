import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Tons baseados nos tokens de status. Usados em fundo suave (/10) + texto na cor cheia,
// padrão sóbrio do produto. "primary" é o laranja-acento.
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none",
  {
    variants: {
      tone: {
        success: "border-transparent bg-success/10 text-success",
        warning: "border-transparent bg-warning/15 text-warning-foreground",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        info: "border-transparent bg-info/10 text-info",
        primary: "border-transparent bg-primary/10 text-primary",
        muted: "border-transparent bg-muted text-muted-foreground",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      tone: "muted",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, tone, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants };
