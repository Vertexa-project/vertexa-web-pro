import { Navigate, Outlet, useLocation } from "react-router-dom";

import { PASSWORD_RESET_PATH, shouldRouteToPasswordRecovery } from "@/lib/auth/passwordRecovery";

/**
 * Intercepta falha/sucesso de recovery que caiu no SITE_URL (ou outra rota clínica)
 * ANTES de montar AppShell / PlatformShell / onboarding.
 */
export function AuthRecoveryRedirect() {
  const location = useLocation();

  if (
    shouldRouteToPasswordRecovery({
      pathname: location.pathname,
      hash: location.hash,
      search: location.search,
    })
  ) {
    return (
      <Navigate
        to={{
          pathname: PASSWORD_RESET_PATH,
          hash: location.hash,
          search: location.search,
        }}
        replace
      />
    );
  }

  return <Outlet />;
}
