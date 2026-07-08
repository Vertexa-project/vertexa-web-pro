import * as React from "react";
import { Navigate } from "react-router-dom";

import { LoadingState } from "@/components/feedback/LoadingState";
import { AUTH_MODE } from "@/lib/auth/authMode";
import { useIdentity } from "@/hooks/useIdentity";
import { PendingAccessPage } from "@/pages/PendingAccessPage";
import { useAuth } from "@/providers/auth-context";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const identity = useIdentity();

  if (loading || identity.status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Auth real: sessão válida mas ainda sem professional/clínica → acesso pendente
  // (não renderiza o painel, não vê dados). Em demo, status nunca é "pending".
  if (AUTH_MODE === "real" && identity.status === "pending") {
    return <PendingAccessPage />;
  }

  return <>{children}</>;
}
