import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { LoadingState } from "@/components/feedback/LoadingState";
import { PASSWORD_RESET_PATH } from "@/lib/auth/passwordRecovery";
import { useAuth } from "@/providers/auth-context";

/**
 * Gate SOMENTE de sessão. Não exige professional, clínica, membership nem papel clínico.
 * Reutilizado por `/access` e `/platform`.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading, isPasswordRecovery } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (isPasswordRecovery) {
    return <Navigate to={PASSWORD_RESET_PATH} replace />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
