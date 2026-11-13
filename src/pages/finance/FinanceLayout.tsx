import { Navigate, Outlet } from "react-router-dom";

import { SubNav } from "@/components/fin/FinUi";
import { LoadingState } from "@/components/feedback/LoadingState";
import { useFinContext } from "@/hooks/useFin";
import { canSeeFinanceCadastros } from "@/lib/domain/finAccess";
import { FinancePage } from "@/pages/FinancePage";
import { NoAccess } from "@/pages/finance/NoAccess";
import { PageHeader } from "@/components/PageHeader";

/**
 * Financeiro com abas: «Mensalidades» (a tela de sempre, só admin) e «Cadastros» (admin, gestor e financeiro,
 * pela matriz de papéis). Quem não é admin cai direto em Cadastros.
 */
export function FinanceLayout() {
  const { access, isLoading } = useFinContext();
  if (isLoading) return <LoadingState />;
  const cadastros = canSeeFinanceCadastros(access) || access.isAdmin;
  if (!access.isAdmin && !cadastros) {
    return (
      <div className="space-y-6">
        <PageHeader title="Financeiro" />
        <NoAccess text="Esta área é só para o administrador da clínica e para quem tem papel financeiro." />
      </div>
    );
  }
  const tabs = [
    ...(access.isAdmin ? [{ to: "/financeiro", label: "Mensalidades", end: true }] : []),
    ...(cadastros ? [{ to: "/financeiro/cadastros", label: "Cadastros" }] : []),
  ];
  return (
    <div className="min-w-0 space-y-6">
      <SubNav items={tabs} label="Seções do financeiro" />
      <Outlet />
    </div>
  );
}

/** Aba «Mensalidades»: a FinancePage atual, sem alteração. Quem não é admin é levado a Cadastros. */
export function FinanceMensalidades() {
  const { access, isLoading } = useFinContext();
  if (isLoading) return <LoadingState />;
  if (!access.isAdmin) return <Navigate to="/financeiro/cadastros" replace />;
  return <FinancePage />;
}
