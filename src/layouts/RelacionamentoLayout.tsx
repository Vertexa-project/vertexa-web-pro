import { Outlet } from "react-router-dom";

import { SectionTabs } from "./SectionTabs";
import { RELACIONAMENTO_TABS } from "@/lib/domain/gestaoNav";

/** Moldura de «Relacionamento»: sub-abas Mensagens e Campanhas sobre as páginas de sempre. */
export function RelacionamentoLayout() {
  return (
    <div className="min-w-0 space-y-6">
      <SectionTabs tabs={RELACIONAMENTO_TABS} label="Seções de Relacionamento" />
      <Outlet />
    </div>
  );
}
