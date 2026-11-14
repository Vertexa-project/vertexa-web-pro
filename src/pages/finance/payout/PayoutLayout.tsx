// Financeiro › Repasse (Entrega 5): lançamentos por profissional/competência, regras e simulador. O fechamento mensal (extrato, aceite, pagamento) é da Entrega 6.
import { Outlet } from "react-router-dom";

import { SubNav } from "@/components/fin/FinUi";
import { LoadingState } from "@/components/feedback/LoadingState";
import { useFinContext } from "@/hooks/useFin";
import { canSeePayout, canSeePayoutRules } from "@/lib/domain/finAccess";
import { NoAccess } from "@/pages/finance/NoAccess";

export function PayoutLayout() {
  const { access, isLoading } = useFinContext();
  if (isLoading) return <LoadingState />;
  if (!canSeePayout(access)) return <NoAccess />;
  const tabs = [
    { to: "/financeiro/repasse", label: "Lançamentos", end: true },
    ...(canSeePayoutRules(access) ? [{ to: "/financeiro/repasse/regras", label: "Regras" }, { to: "/financeiro/repasse/simulador", label: "Simulador" }] : []),
  ];
  return (
    <div className="min-w-0 space-y-4">
      {tabs.length > 1 ? <SubNav items={tabs} label="Seções do repasse" /> : null}
      <Outlet />
    </div>
  );
}
