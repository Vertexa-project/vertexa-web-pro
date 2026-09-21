import { Link } from "react-router-dom";

import { useMyClinicCommercialAccess } from "@/hooks/useCommercialAccess";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";

export function CommercialObserveBanner() {
  const { data: me } = useCurrentProfessional();
  const clinicId = me?.clinicId ?? null;
  const access = useMyClinicCommercialAccess(clinicId, Boolean(clinicId));
  const { isClinicAdmin } = useIsClinicAdmin(clinicId);

  if (access.data?.reason !== "OBSERVE_ONLY") return null;

  return (
    <div
      role="status"
      className="border-b border-border bg-muted/60 px-4 py-2 text-sm text-foreground md:px-8"
    >
      Esta clínica ainda não tem contrato comercial ativo. O acesso atual está em observação
      {isClinicAdmin ? (
        <>
          .{" "}
          <Link to="/configuracoes/faturamento" className="font-medium underline underline-offset-4">
            Ver Faturamento / Planos
          </Link>
        </>
      ) : (
        "."
      )}
    </div>
  );
}
