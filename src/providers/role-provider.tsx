import { useCallback, useMemo, useState } from "react";

import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { deriveRole, permissionsFor, roleLabel, type Role } from "@/lib/domain/roles";
import { useAuth } from "./auth-context";
import { RoleContext, type RoleContextValue } from "./role-context";

/**
 * RBAC de UI (Sessão 7). Deriva o papel do profissional logado (demo: Dra. Camila → nutri)
 * e permite um OVERRIDE de DEMONSTRAÇÃO em runtime (sem auth real, sem persistir no banco),
 * para mostrar admin vs médico vs nutri ao vivo. O override mora só em memória (reset no reload).
 *
 * ⚠️ O override SÓ vale em modo demonstração. Sob auth real, `setDemoRole` é no-op e o papel
 * efetivo é sempre o derivado — um usuário real não troca o próprio papel pela UI.
 */
export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { data: professional } = useCurrentProfessional();
  const { demoMode } = useAuth();
  const [demoRole, setDemoRoleState] = useState<Role | null>(null);

  // Fora do modo demo, ignora qualquer tentativa de trocar de papel.
  const setDemoRole = useCallback(
    (r: Role | null) => {
      if (demoMode) setDemoRoleState(r);
    },
    [demoMode],
  );

  const value = useMemo<RoleContextValue>(() => {
    const baseRole = deriveRole(professional?.profileRole, professional?.type);
    const override = demoMode ? demoRole : null; // override só em demo
    const role = override ?? baseRole;
    return {
      role,
      perms: permissionsFor(role),
      roleLabel: roleLabel(role),
      baseRole,
      isDemoOverride: override !== null && override !== baseRole,
      setDemoRole,
    };
  }, [professional?.profileRole, professional?.type, demoRole, demoMode, setDemoRole]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}
