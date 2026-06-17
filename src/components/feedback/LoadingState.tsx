import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface LoadingStateProps {
  label?: string;
  className?: string;
}

/** Spinner centralizado para carregamentos sem layout de skeleton dedicado. */
export function LoadingState({ label = "Carregando…", className }: LoadingStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground", className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}
