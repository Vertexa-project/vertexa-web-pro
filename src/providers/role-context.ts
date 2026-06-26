import { createContext, useContext } from "react";

import type { Role, RolePermissions } from "@/lib/domain/roles";

export interface RoleContextValue {
  /** Papel EFETIVO (base do profissional logado OU override de demonstração). */
  role: Role;
  perms: RolePermissions;
  roleLabel: string;
  /** Papel real derivado do profissional logado (sem override). */
  baseRole: Role;
  /** Há um override de demonstração ativo? */
  isDemoOverride: boolean;
  /** Troca o papel ativo em runtime (modo demonstração; não persiste no banco). `null` = volta ao base. */
  setDemoRole: (role: Role | null) => void;
}

export const RoleContext = createContext<RoleContextValue | undefined>(undefined);

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole deve ser usado dentro de <RoleProvider>");
  return ctx;
}
