// Casca do Estoque: título, abas pela matriz de papéis (Itens + Saldo, Entradas, Saídas e Movimentações) e o conteúdo da aba.
import type { ReactNode } from "react";

import { SubNav } from "@/components/fin/FinUi";
import { PageHeader } from "@/components/PageHeader";
import { useFinContext } from "@/hooks/useFin";
import { stockTabs } from "@/lib/domain/finAccess";

export function StockShell({ description, actions, children }: { description: string; actions?: ReactNode; children: ReactNode }) {
  const { access } = useFinContext();
  const tabs = stockTabs(access);
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="Estoque" description={description} actions={actions} />
      {tabs.length > 0 ? <SubNav items={tabs} label="Seções do estoque" /> : null}
      {children}
    </div>
  );
}
