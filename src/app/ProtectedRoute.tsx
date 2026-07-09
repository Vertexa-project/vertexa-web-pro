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

  // Espera pela SESSÃO (como antes). No modo real, também espera a resolução da identidade
  // para não piscar o painel antes de saber se é 'pending'. No modo demo, NÃO bloqueamos o
  // shell na query de identidade — o painel monta e cada seção faz seu próprio skeleton
  // (comportamento IDÊNTICO ao de antes do WP-03).
  const waitingIdentity = AUTH_MODE === "real" && identity.status === "loading";
  if (loading || waitingIdentity) {
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
