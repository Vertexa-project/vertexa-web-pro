import { Navigate } from "react-router-dom";

import { LoadingState } from "@/components/feedback/LoadingState";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import { resolvePlatformAdminAccess, resolvePostAuthDestination } from "@/lib/domain/platformAdmin";

import { PlatformAuthorityError } from "./PlatformAuthorityError";

/**
 * Resolvedor ÚNICO de destino pós-autenticação. Login e callback só apontam para `/access`.
 * A autoridade NÃO é decidida nesses dois arquivos.
 */
export function AccessResolver() {
  const signal = useAmIPlatformAdmin(true);
  const destination = resolvePostAuthDestination(
    resolvePlatformAdminAccess({
      data: signal.isPlatformAdmin,
      isLoading: signal.isLoading,
      isError: signal.isError,
    }),
  );

  if (destination.kind === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (destination.kind === "error") {
    return <PlatformAuthorityError onRetry={signal.refetch} />;
  }

  return <Navigate to={destination.to} replace />;
}
