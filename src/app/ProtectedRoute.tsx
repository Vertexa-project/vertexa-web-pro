import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";

import { LoadingState } from "@/components/feedback/LoadingState";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import { useMyClinicCommercialAccess } from "@/hooks/useCommercialAccess";
import { useIdentity } from "@/hooks/useIdentity";
import { useMyClinicMemberships } from "@/hooks/useProfessionalStatus";
import { resolveCommercialShellGate } from "@/lib/domain/commercialAccess";
import { pickActingMembership, resolveClinicAccess } from "@/lib/domain/professionalStatus";
import {
  resolvePendingOnboardingGate,
  resolvePlatformAdminAccess,
} from "@/lib/domain/platformAdmin";
import { CommercialActivationPage } from "@/pages/CommercialActivationPage";
import {
  ClinicAccessRevokedPage,
  NoClinicMembershipPage,
} from "@/pages/ClinicAccessRevokedPage";
import { ClinicSuspendedPage } from "@/pages/ClinicSuspendedPage";
import { PendingAccessPage } from "@/pages/PendingAccessPage";

import { CommercialAccessError } from "./CommercialAccessError";
import { AuthGate } from "./AuthGate";
import { PlatformAuthorityError } from "./PlatformAuthorityError";

function ClinicAccessGate({ children }: { children: React.ReactNode }) {
  const identity = useIdentity();
  const location = useLocation();

  const waitingIdentity = identity.status === "loading";
  const askMemberships = identity.status === "active";
  const askPlatformAdmin = identity.status === "pending";
  const platformAdmin = useAmIPlatformAdmin(askPlatformAdmin);
  const memberships = useMyClinicMemberships(askMemberships);
  const clinicAccess = resolveClinicAccess({
    memberships: memberships.data,
    isLoading: memberships.isLoading,
    isError: memberships.isError,
  });
  const actingClinicId =
    askMemberships && clinicAccess === "ok"
      ? pickActingMembership(memberships.data ?? [])?.clinicId ?? null
      : null;
  const commercial = useMyClinicCommercialAccess(actingClinicId, Boolean(actingClinicId));

  if (waitingIdentity) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (identity.status === "pending") {
    const pendingGate = resolvePendingOnboardingGate(
      resolvePlatformAdminAccess({
        data: platformAdmin.isPlatformAdmin,
        isLoading: platformAdmin.isLoading,
        isError: platformAdmin.isError,
      }),
    );

    if (pendingGate === "loading") {
      return (
        <div className="flex h-screen items-center justify-center">
          <LoadingState />
        </div>
      );
    }
    if (pendingGate === "error") {
      return <PlatformAuthorityError onRetry={platformAdmin.refetch} />;
    }
    if (pendingGate === "platform") {
      return <Navigate to="/platform" replace />;
    }
    return <PendingAccessPage />;
  }

  if (askMemberships) {
    if (clinicAccess === "loading") {
      return (
        <div className="flex h-screen items-center justify-center">
          <LoadingState />
        </div>
      );
    }
    if (clinicAccess === "deactivated") {
      return <ClinicAccessRevokedPage clinics={memberships.data ?? []} />;
    }
    if (clinicAccess === "clinic-suspended") {
      return <ClinicSuspendedPage clinics={memberships.data ?? []} />;
    }
    if (clinicAccess === "no-clinic") {
      return <NoClinicMembershipPage />;
    }
    if (clinicAccess === "ok") {
      if (commercial.isLoading) {
        return (
          <div className="flex h-screen items-center justify-center">
            <LoadingState />
          </div>
        );
      }
      const shell = resolveCommercialShellGate({
        isLoading: commercial.isLoading,
        isError: commercial.isError,
        error: commercial.error,
        productAllowed: commercial.data?.productAllowed,
        pathname: location.pathname,
      });
      if (shell === "auth_required") {
        return <Navigate to="/login" replace />;
      }
      if (shell === "resolution_failed") {
        return <CommercialAccessError onRetry={() => void commercial.refetch()} />;
      }
      if (shell === "pre_contract") {
        return <CommercialActivationPage />;
      }
    }
  }

  return <>{children}</>;
}

/**
 * Área clínica: sessão (AuthGate) + identidade + membership.
 * Platform Admin puro (`pending`) é desviado para `/platform` ANTES do onboarding clínico.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <ClinicAccessGate>{children}</ClinicAccessGate>
    </AuthGate>
  );
}
