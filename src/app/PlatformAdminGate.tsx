import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { LoadingState } from "@/components/feedback/LoadingState";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import { resolvePlatformAdminAccess } from "@/lib/domain/platformAdmin";

import { PlatformAuthorityError } from "./PlatformAuthorityError";

/**
 * Guard de `/platform`. Autoridade = `public.am_i_platform_admin()`.
 * URL digitada passa pelo mesmo gate (não confiar em menu oculto).
 */
export function PlatformAdminGate({ children }: { children: ReactNode }) {
  const signal = useAmIPlatformAdmin(true);
  const access = resolvePlatformAdminAccess({
    data: signal.isPlatformAdmin,
    isLoading: signal.isLoading,
    isError: signal.isError,
  });

  if (access === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (access === "error") {
    return <PlatformAuthorityError onRetry={signal.refetch} />;
  }

  if (access === "denied") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
