import { Navigate, Outlet } from "react-router-dom";

import { SubNav } from "@/components/fin/FinUi";
import { LoadingState } from "@/components/feedback/LoadingState";
import { useFinContext } from "@/hooks/useFin";
import { financeTabs } from "@/lib/domain/finAccess";
import { FinancePage } from "@/pages/FinancePage";
import { NoAccess } from "@/pages/finance/NoAccess";
import { PageHeader } from "@/components/PageHeader";

/**
 * Financeiro com abas pela matriz de papéis: Mensalidades (a tela de sempre, só admin), Vendas, Títulos, Caixa e Cadastros.
 */
export function FinanceLayout() {
  const { access, isLoading } = useFinContext();
  if (isLoading) return <LoadingState />;
  const tabs = financeTabs(access);
  if (tabs.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Financeiro" />
        <NoAccess text="Esta área é só para o administrador da clínica e para quem tem papel financeiro." />
      </div>
    );
  }
  return (
    <div className="min-w-0 space-y-6">
      <SubNav items={tabs} label="Seções do financeiro" />
      <Outlet />
    </div>
  );
}

/** Aba «Mensalidades»: a FinancePage atual, sem alteração. Quem não é admin vai para a primeira aba que o papel alcança. */
export function FinanceMensalidades() {
  const { access, isLoading } = useFinContext();
  if (isLoading) return <LoadingState />;
  if (!access.isAdmin) return <Navigate to={financeTabs(access)[0]?.to ?? "/financeiro/cadastros"} replace />;
  return <FinancePage />;
}
