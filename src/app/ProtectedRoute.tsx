import * as React from "react";
import { Navigate } from "react-router-dom";

import { LoadingState } from "@/components/feedback/LoadingState";
import { AUTH_MODE } from "@/lib/auth/authMode";
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

  // Espera pela SESSÃO (como antes). No modo real, também espera a resolução da identidade
  // para não piscar o painel antes de saber se é 'pending'. No modo demo, NÃO bloqueamos o
  // shell na query de identidade — o painel monta e cada seção faz seu próprio skeleton
  // (comportamento IDÊNTICO ao de antes do WP-03).
  const waitingIdentity = AUTH_MODE === "real" && identity.status === "loading";

  /**
   * WP-FRONT-2bii-A item 3 — O PAINEL PRECISA SABER DIZER "VOCÊ FOI DESATIVADO".
   *
   * Por que esta pergunta não existia: quem é desativado continua com sessão, profile E linha em
   * `professionals` (a policy deixa qualquer um ler a PRÓPRIA linha), então `identity.status`
   * resolve como "active" e o painel monta inteiro — só que TODA consulta escopada por clínica
   * volta vazia, sem erro. Medido: listagem "nenhuma paciente", kanban sem coluna, Configurações
   * sem nome de clínica, e um único 42501 real (get_or_create_channel). Painel normal e vazio.
   *
   * A RPC `my_clinic_memberships` é a única leitura que sobra para quem foi cortado (ele perdeu
   * `clinics_select`) e responde exatamente o que falta: em que clínicas eu tenho cadastro e qual
   * é o MEU status em cada uma.
   *
   * Só perguntamos no modo REAL e com identidade resolvida como ativa — demo não tem sessão, e
   * 'pending' já tem tela própria (e nem professional resolvido teria).
   */
  const askMemberships = AUTH_MODE === "real" && identity.status === "active";
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

  // Auth real: sessão válida mas ainda sem professional/clínica → acesso pendente
  // (não renderiza o painel, não vê dados). Em demo, status nunca é "pending".
  if (AUTH_MODE === "real" && identity.status === "pending") {
    return <PendingAccessPage />;
  }

  if (askMemberships) {
    // Esperamos a resposta ANTES de montar o painel: piscar a listagem "sem pacientes" para quem
    // foi desativado é exatamente a mentira que este WP veio matar. É UMA RPC, cacheada.
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
    // "ok" e "unknown" caem no painel. `unknown` é FAIL-OPEN de propósito (ver
    // resolveClinicAccess): esta tela é explicação, não portão — o portão é a RLS. Trancar o
    // painel por falha de rede trocaria uma explicação por um incidente para quem está ATIVO.
  }

  return <>{children}</>;
}
