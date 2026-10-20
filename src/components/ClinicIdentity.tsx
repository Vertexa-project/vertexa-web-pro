import { useState } from "react";

import { BrandMark } from "@/components/Brand";
import { useClinicBrand } from "@/hooks/useClinicBrand";
import { brandInitials } from "@/lib/domain/clinicBrand";
import { cn } from "@/lib/utils";

/**
 * Identidade da clínica no topo do app: logo (ou iniciais) + nome da clínica em destaque e a Vertexa como
 * assinatura secundária. Sem clínica resolvida (ou carregando) cai na marca Vertexa — nunca fica em branco.
 */
export function ClinicIdentity({ markClassName, compact = false }: { markClassName?: string; compact?: boolean }) {
  const brand = useClinicBrand();
  const [broken, setBroken] = useState<string | null>(null);
  const b = brand.data;

  if (!b) return <BrandMark className={cn("h-9 w-9", markClassName)} />;

  const showImg = Boolean(b.logoUrl) && broken !== b.logoUrl;
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      {showImg ? (
        <img
          src={b.logoUrl as string}
          alt={`Logo de ${b.name}`}
          onError={() => setBroken(b.logoUrl)}
          className={cn("h-9 w-9 shrink-0 rounded-lg bg-white object-contain", markClassName)}
        />
      ) : (
        <span
          aria-hidden
          className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground", markClassName)}
          style={b.color ? { backgroundColor: b.color } : undefined}
        >
          {brandInitials(b.name)}
        </span>
      )}
      {compact ? null : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-display text-sm font-bold text-foreground">{b.name}</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">via Vertexa</span>
        </span>
      )}
    </span>
  );
}
