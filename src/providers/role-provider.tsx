import { useMemo, type ReactNode } from "react";

import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { deriveRole, permissionsFor, roleLabel } from "@/lib/domain/roles";
import { RoleContext, type RoleContextValue } from "./role-context";

/**
 * RBAC de UI. Deriva o papel do profissional logado — sem override em runtime.
 * A autoridade clínica vem das disciplinas; isAdmin de UI não substitui a RPC am_i_clinic_admin.
 */
export function RoleProvider({ children }: { children: ReactNode }) {
  const { data: professional } = useCurrentProfessional();

  const value = useMemo<RoleContextValue>(() => {
    const role = deriveRole(professional?.profileRole, professional?.type);
    return {
      role,
      perms: permissionsFor(role),
      roleLabel: roleLabel(role),
    };
  }, [professional?.profileRole, professional?.type]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}
