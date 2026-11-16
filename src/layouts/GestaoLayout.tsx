import { Outlet } from "react-router-dom";

import { SectionTabs } from "./SectionTabs";
import { useCurrentProfessional } from "@/hooks/useCurrentProfessional";
import { useFinContext } from "@/hooks/useFin";
import { useIsClinicAdmin } from "@/hooks/useIsClinicAdmin";
import { gestaoTabs } from "@/lib/domain/gestaoNav";

/**
 * Moldura de «Gestão»: sub-abas Visão geral / Financeiro / Estoque / Documentos acima das páginas que já existiam
 * (/gestao, /financeiro/*, /estoque/*, /documentos). Cada sub-aba só aparece pela mesma regra de papéis de antes.
 */
export function GestaoLayout() {
  const { data: professional } = useCurrentProfessional();
  const { isClinicAdmin } = useIsClinicAdmin(professional?.clinicId ?? null);
  const { access } = useFinContext();
  const tabs = gestaoTabs(isClinicAdmin, access);
  return (
    <div className="min-w-0 space-y-6">
      <SectionTabs tabs={tabs} label="Seções de Gestão" />
      <Outlet />
    </div>
  );
}
