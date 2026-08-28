import * as React from "react";
import { Navigate } from "react-router-dom";

import { LoadingState } from "@/components/feedback/LoadingState";
import { useAmIPlatformAdmin } from "@/hooks/useAmIPlatformAdmin";
import { useIdentity } from "@/hooks/useIdentity";
import { useMyClinicMemberships } from "@/hooks/useProfessionalStatus";
import { resolveClinicAccess } from "@/lib/domain/professionalStatus";
import {
  resolvePendingOnboardingGate,
  resolvePlatformAdminAccess,
} from "@/lib/domain/platformAdmin";
import {
  ClinicAccessRevokedPage,
  NoClinicMembershipPage,
} from "@/pages/ClinicAccessRevokedPage";
import { PendingAccessPage } from "@/pages/PendingAccessPage";

import { AuthGate } from "./AuthGate";
import { PlatformAuthorityError } from "./PlatformAuthorityError";

function ClinicAccessGate({ children }: { children: React.ReactNode }) {
  const identity = useIdentity();

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
    if (clinicAccess === "no-clinic") {
      return <NoClinicMembershipPage />;
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
