import * as React from "react";
import { Navigate } from "react-router-dom";

import { LoadingState } from "@/components/feedback/LoadingState";
import { useIdentity } from "@/hooks/useIdentity";
import { useMyClinicMemberships } from "@/hooks/useProfessionalStatus";
import { resolveClinicAccess } from "@/lib/domain/professionalStatus";
import {
  ClinicAccessRevokedPage,
  NoClinicMembershipPage,
} from "@/pages/ClinicAccessRevokedPage";
import { PendingAccessPage } from "@/pages/PendingAccessPage";
import { useAuth } from "@/providers/auth-context";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const identity = useIdentity();

  const waitingIdentity = identity.status === "loading";
  const askMemberships = identity.status === "active";
  const memberships = useMyClinicMemberships(askMemberships);
  const clinicAccess = resolveClinicAccess({
    memberships: memberships.data,
    isLoading: memberships.isLoading,
    isError: memberships.isError,
  });

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

  if (identity.status === "pending") {
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
