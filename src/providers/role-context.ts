import { createContext, useContext } from "react";

import type { Role, RolePermissions } from "@/lib/domain/roles";

export interface RoleContextValue {
  /** Papel derivado do profissional logado (profiles.role / professionals.type). Sem override. */
  role: Role;
  perms: RolePermissions;
  roleLabel: string;
}

export const RoleContext = createContext<RoleContextValue | undefined>(undefined);

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole deve ser usado dentro de <RoleProvider>");
  return ctx;
}
