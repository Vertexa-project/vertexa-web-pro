import { cn } from "@/lib/utils";

/**
 * Marca VERTEXA. Assinatura visual = "vertex/pico": um ápice (linha que sobe até um
 * ponto) dentro de um tile laranja — evoca o nome (vertex = ápice) e a promessa do
 * produto (adesão/retenção em alta). Acento laranja via token (inalterado).
 */
export function BrandMark({
  className,
  variant = "default",
}: {
  className?: string;
  /** "onDark" = tile translúcido p/ usar sobre fundo escuro (ex.: gradiente do login). */
  variant?: "default" | "onDark";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[28%]",
        variant === "onDark"
          ? "bg-white/15 text-white backdrop-blur"
          : "bg-primary text-primary-foreground shadow-sm",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" className="h-[62%] w-[62%]" fill="none" role="img">
        {/* ápice (pico) — sobe até o vértice */}
        <path
          d="M5.5 23 L16 8.5 L26.5 23"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* o vértice em si */}
        <circle cx="16" cy="8.5" r="1.9" fill="currentColor" />
      </svg>
    </span>
  );
}

interface BrandProps {
  /** Mostra a wordmark "VERTEXA" ao lado do tile. */
  showWordmark?: boolean;
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}

export function Brand({ showWordmark = true, className, markClassName, wordmarkClassName }: BrandProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark className={cn("h-9 w-9", markClassName)} />
      {showWordmark ? (
        <span
          className={cn(
            "font-display text-lg font-bold leading-none tracking-[-0.01em] text-foreground",
            wordmarkClassName,
          )}
        >
          VERTEXA
        </span>
      ) : null}
    </span>
  );
}
