import { Navigate, Outlet, useLocation } from "react-router-dom";

import { SubNav } from "@/components/fin/FinUi";
import { PageHeader } from "@/components/PageHeader";
import { useFinContext } from "@/hooks/useFin";
import { finCan, type FinAccess } from "@/lib/domain/finAccess";

interface CadastroTab { to: string; label: string; allowed: (a: FinAccess) => boolean }

const CADASTRO_TABS: CadastroTab[] = [
  { to: "/financeiro/cadastros/servicos", label: "Serviços", allowed: (a) => finCan(a, "services") },
  { to: "/financeiro/cadastros/pacotes", label: "Pacotes", allowed: (a) => finCan(a, "packages") },
  { to: "/financeiro/cadastros/profissionais", label: "Profissionais", allowed: (a) => finCan(a, "pro_finance") },
  { to: "/financeiro/cadastros/meios-de-pagamento", label: "Meios de pagamento", allowed: (a) => finCan(a, "payment") },
  { to: "/financeiro/cadastros/impostos", label: "Impostos e configurações", allowed: (a) => finCan(a, "tax") || finCan(a, "settings") },
  { to: "/financeiro/cadastros/historico", label: "Histórico", allowed: (a) => finCan(a, "audit") },
];

/** Aba «Cadastros» do Financeiro: sub-abas filtradas pelo papel. */
export function CadastrosLayout() {
  const { access } = useFinContext();
  const { pathname } = useLocation();
  const tabs = CADASTRO_TABS.filter((t) => t.allowed(access));
  if (pathname.replace(/\/$/, "") === "/financeiro/cadastros" && tabs[0]) return <Navigate to={tabs[0].to} replace />;
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="Cadastros financeiros" description="Serviços, pacotes, profissionais, meios de pagamento, impostos e o histórico de mudanças." />
      <SubNav items={tabs} label="Cadastros" />
      <Outlet />
    </div>
  );
}
