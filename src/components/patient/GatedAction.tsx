import { useId } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface GatedActionProps extends ButtonProps {
  /** Quando false, o botão fica desabilitado e o motivo aparece (não some sem explicação). */
  canEdit: boolean;
  /** Motivo PT-BR do bloqueio (RBAC de UI por papel). */
  reason: string;
  /** Classe do wrapper (ex.: alinhamento). */
  wrapperClassName?: string;
}

/**
 * Ação de edição condicionada ao papel (RBAC de UI). Se o papel não pode editar, o botão
 * NÃO some — fica desabilitado com `aria-disabled` + um motivo visível ligado por
 * `aria-describedby` (acessível por teclado/leitor de tela). Gating de UI, não autorização.
 */
export function GatedAction({ canEdit, reason, wrapperClassName, children, className, ...buttonProps }: GatedActionProps) {
  const reasonId = useId();
  if (canEdit) {
    return (
      <Button className={className} {...buttonProps}>
        {children}
      </Button>
    );
  }
  // Bloqueado: NÃO usar `disabled` nativo (tira o botão da ordem de foco e o motivo via
  // aria-describedby fica inalcançável). Mantém focável com aria-disabled + clique neutralizado
  // + visual desabilitado por classe → teclado/leitor de tela leem label + estado + motivo.
  return (
    <div className={cn("flex flex-col gap-1.5", wrapperClassName)}>
      <Button
        {...buttonProps}
        className={cn(className, "cursor-not-allowed opacity-60")}
        aria-disabled
        aria-describedby={reasonId}
        onClick={(e) => e.preventDefault()}
      >
        {children}
      </Button>
      <span id={reasonId} className="max-w-[15rem] text-xs text-muted-foreground">
        {reason}
      </span>
    </div>
  );
}
