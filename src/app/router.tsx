import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";

import { AppShell } from "@/layouts/AppShell";
import { PlatformShell } from "@/layouts/PlatformShell";
import { LoadingState } from "@/components/feedback/LoadingState";
import { AccessResolver } from "./AccessResolver";
import { AuthGate } from "./AuthGate";
import { AuthRecoveryRedirect } from "./AuthRecoveryRedirect";
import { PlatformAdminGate } from "./PlatformAdminGate";
import { ProtectedRoute } from "./ProtectedRoute";

// Code-splitting por rota: cada página vira um chunk próprio (recharts/editores fora do bundle inicial).
const LoginPage = lazy(() => import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const AuthCallback = lazy(() => import("@/app/AuthCallback").then((m) => ({ default: m.AuthCallback })));
const ForgotPasswordPage = lazy(() =>
  import("@/pages/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage })),
);
const UpdatePasswordPage = lazy(() =>
  import("@/pages/UpdatePasswordPage").then((m) => ({ default: m.UpdatePasswordPage })),
);
const ExerciseLibraryPage = lazy(() =>
  import("@/pages/ExerciseLibraryPage").then((m) => ({ default: m.ExerciseLibraryPage })),
);
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const PatientsPage = lazy(() => import("@/pages/PatientsPage").then((m) => ({ default: m.PatientsPage })));
const EncounterPage = lazy(() => import("@/pages/EncounterPage").then((m) => ({ default: m.EncounterPage })));
const PatientProfilePage = lazy(() =>
  import("@/pages/PatientProfilePage").then((m) => ({ default: m.PatientProfilePage })),
);
const PlansPage = lazy(() => import("@/pages/PlansPage").then((m) => ({ default: m.PlansPage })));
const MessagesPage = lazy(() => import("@/pages/MessagesPage").then((m) => ({ default: m.MessagesPage })));
const CampaignsPage = lazy(() => import("@/pages/CampaignsPage").then((m) => ({ default: m.CampaignsPage })));
const ManagementPage = lazy(() => import("@/pages/ManagementPage").then((m) => ({ default: m.ManagementPage })));
const FinanceLayout = lazy(() => import("@/pages/finance/FinanceLayout").then((m) => ({ default: m.FinanceLayout })));
const FinanceMensalidades = lazy(() => import("@/pages/finance/FinanceLayout").then((m) => ({ default: m.FinanceMensalidades })));
const SalesTab = lazy(() => import("@/pages/finance/SalesTab").then((m) => ({ default: m.SalesTab })));
const TitlesTab = lazy(() => import("@/pages/finance/TitlesTab").then((m) => ({ default: m.TitlesTab })));
const CashTab = lazy(() => import("@/pages/finance/CashTab").then((m) => ({ default: m.CashTab })));
const CadastrosLayout = lazy(() => import("@/pages/finance/CadastrosLayout").then((m) => ({ default: m.CadastrosLayout })));
const ServicesTab = lazy(() => import("@/pages/finance/ServicesTab").then((m) => ({ default: m.ServicesTab })));
const PackagesTab = lazy(() => import("@/pages/finance/PackagesTab").then((m) => ({ default: m.PackagesTab })));
const ProfessionalsFinanceTab = lazy(() => import("@/pages/finance/ProfessionalsFinanceTab").then((m) => ({ default: m.ProfessionalsFinanceTab })));
const PaymentMethodsTab = lazy(() => import("@/pages/finance/PaymentMethodsTab").then((m) => ({ default: m.PaymentMethodsTab })));
const TaxSettingsTab = lazy(() => import("@/pages/finance/TaxSettingsTab").then((m) => ({ default: m.TaxSettingsTab })));
const AuditTab = lazy(() => import("@/pages/finance/AuditTab").then((m) => ({ default: m.AuditTab })));
const StockPage = lazy(() => import("@/pages/StockPage").then((m) => ({ default: m.StockPage })));
const StockBalanceTab = lazy(() => import("@/pages/stock/StockBalanceTab").then((m) => ({ default: m.StockBalanceTab })));
const StockEntriesTab = lazy(() => import("@/pages/stock/StockEntriesTab").then((m) => ({ default: m.StockEntriesTab })));
const StockExitsTab = lazy(() => import("@/pages/stock/StockExitsTab").then((m) => ({ default: m.StockExitsTab })));
const StockMovementsTab = lazy(() => import("@/pages/stock/StockMovementsTab").then((m) => ({ default: m.StockMovementsTab })));
const StockShortfallsTab = lazy(() => import("@/pages/stock/StockShortfallsTab").then((m) => ({ default: m.StockShortfallsTab })));
const AppointmentsTab = lazy(() => import("@/pages/finance/AppointmentsTab").then((m) => ({ default: m.AppointmentsTab })));
const PayoutLayout = lazy(() => import("@/pages/finance/payout/PayoutLayout").then((m) => ({ default: m.PayoutLayout })));
const PayoutLinesTab = lazy(() => import("@/pages/finance/payout/PayoutLinesTab").then((m) => ({ default: m.PayoutLinesTab })));
const PayoutRulesTab = lazy(() => import("@/pages/finance/payout/PayoutRulesTab").then((m) => ({ default: m.PayoutRulesTab })));
const PayoutSimulatorTab = lazy(() => import("@/pages/finance/payout/PayoutSimulatorTab").then((m) => ({ default: m.PayoutSimulatorTab })));
const PatientPackagesTab = lazy(() => import("@/pages/finance/PatientPackagesTab").then((m) => ({ default: m.PatientPackagesTab })));
const UnitsPage = lazy(() => import("@/pages/UnitsPage").then((m) => ({ default: m.UnitsPage })));
const RetentionPage = lazy(() => import("@/pages/RetentionPage").then((m) => ({ default: m.RetentionPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const BillingProfilePage = lazy(() =>
  import("@/pages/BillingProfilePage").then((m) => ({ default: m.BillingProfilePage })),
);
const DisciplinesAdminPage = lazy(() =>
  import("@/pages/DisciplinesAdminPage").then((m) => ({ default: m.DisciplinesAdminPage })),
);
const TeamAdminPage = lazy(() =>
  import("@/pages/TeamAdminPage").then((m) => ({ default: m.TeamAdminPage })),
);
const JourneyBoardPage = lazy(() =>
  import("@/pages/JourneyBoardPage").then((m) => ({ default: m.JourneyBoardPage })),
);
const JourneyColumnsAdminPage = lazy(() =>
  import("@/pages/JourneyColumnsAdminPage").then((m) => ({ default: m.JourneyColumnsAdminPage })),
);
const BatchReportPage = lazy(() =>
  import("@/pages/BatchReportPage").then((m) => ({ default: m.BatchReportPage })),
);
const ReportAuditPage = lazy(() =>
  import("@/pages/ReportAuditPage").then((m) => ({ default: m.ReportAuditPage })),
);
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })));
const PlatformDashboardPage = lazy(() =>
  import("@/pages/PlatformDashboardPage").then((m) => ({ default: m.PlatformDashboardPage })),
);
const PlatformClinicsPage = lazy(() =>
  import("@/pages/PlatformClinicsPage").then((m) => ({ default: m.PlatformClinicsPage })),
);
const PlatformRequestsPage = lazy(() =>
  import("@/pages/PlatformRequestsPage").then((m) => ({ default: m.PlatformRequestsPage })),
);
const PlatformSettingsPage = lazy(() =>
  import("@/pages/PlatformSettingsPage").then((m) => ({ default: m.PlatformSettingsPage })),
);
const PlatformBillingLayout = lazy(() =>
  import("@/pages/platform-billing/PlatformBillingLayout").then((m) => ({
    default: m.PlatformBillingLayout,
  })),
);
const PlatformBillingOverviewPage = lazy(() =>
  import("@/pages/platform-billing/PlatformBillingOverviewPage").then((m) => ({
    default: m.PlatformBillingOverviewPage,
  })),
);
const PlatformBillingClinicsPage = lazy(() =>
  import("@/pages/platform-billing/PlatformBillingClinicsPage").then((m) => ({
    default: m.PlatformBillingClinicsPage,
  })),
);
const PlatformBillingChargesPage = lazy(() =>
  import("@/pages/platform-billing/PlatformBillingChargesPage").then((m) => ({
    default: m.PlatformBillingChargesPage,
  })),
);
const PlatformBillingPaymentsPage = lazy(() =>
  import("@/pages/platform-billing/PlatformBillingPaymentsPage").then((m) => ({
    default: m.PlatformBillingPaymentsPage,
  })),
);
const PlatformBillingDelinquencyPage = lazy(() =>
  import("@/pages/platform-billing/PlatformBillingDelinquencyPage").then((m) => ({
    default: m.PlatformBillingDelinquencyPage,
  })),
);
const PlatformBillingPixPage = lazy(() =>
  import("@/pages/platform-billing/PlatformBillingPixPage").then((m) => ({
    default: m.PlatformBillingPixPage,
  })),
);
const PlatformBillingEventsPage = lazy(() =>
  import("@/pages/platform-billing/PlatformBillingEventsPage").then((m) => ({
    default: m.PlatformBillingEventsPage,
  })),
);
const PlatformBillingReportsPage = lazy(() =>
  import("@/pages/platform-billing/PlatformBillingReportsPage").then((m) => ({
    default: m.PlatformBillingReportsPage,
  })),
);
const PlatformBillingCommercialPage = lazy(() =>
  import("@/pages/platform-billing/PlatformBillingCommercialPage").then((m) => ({
    default: m.PlatformBillingCommercialPage,
  })),
);
const PlatformCommercialAccessPage = lazy(() =>
  import("@/pages/platform-billing/PlatformCommercialAccessPage").then((m) => ({
    default: m.PlatformCommercialAccessPage,
  })),
);
const PlatformClinicBillingDetailPage = lazy(() =>
  import("@/pages/platform-billing/PlatformClinicBillingDetailPage").then((m) => ({
    default: m.PlatformClinicBillingDetailPage,
  })),
);

export const router = createBrowserRouter(
  [
    {
      element: <AuthRecoveryRedirect />,
      children: [
        {
          path: "/login",
          element: (
            <Suspense fallback={<LoadingState />}>
              <LoginPage />
            </Suspense>
          ),
        },
        {
          // Retorno do OAuth (Google) — pública; confirma a sessão e redireciona.
          path: "/auth/callback",
          element: (
            <Suspense fallback={<LoadingState />}>
              <AuthCallback />
            </Suspense>
          ),
        },
        {
          path: "/auth/forgot-password",
          element: (
            <Suspense fallback={<LoadingState />}>
              <ForgotPasswordPage />
            </Suspense>
          ),
        },
        {
          // Auth-special: recovery/update. Sem AppShell, PlatformShell, clinic ou PA.
          path: "/auth/update-password",
          element: (
            <Suspense fallback={<LoadingState />}>
              <UpdatePasswordPage />
            </Suspense>
          ),
        },
        {
          // Destino único pós-login: decide Platform Admin vs fluxo clínico. Irmão de `/` e `/platform`.
          path: "/access",
          element: (
            <AuthGate>
              <AccessResolver />
            </AuthGate>
          ),
        },
        {
          // Área global read-only. NÃO é filha do AppShell clínico e NÃO exige membership.
          path: "/platform",
          element: (
            <AuthGate>
              <PlatformAdminGate>
                <PlatformShell />
              </PlatformAdminGate>
            </AuthGate>
          ),
          children: [
            { index: true, element: <PlatformDashboardPage /> },
            { path: "solicitacoes", element: <PlatformRequestsPage /> },
            { path: "clinicas", element: <PlatformClinicsPage /> },
            {
              path: "billing",
              element: <PlatformBillingLayout />,
              children: [
                { index: true, element: <PlatformBillingOverviewPage /> },
                { path: "contratos", element: <PlatformBillingClinicsPage /> },
                { path: "cobrancas", element: <PlatformBillingChargesPage /> },
                { path: "pagamentos", element: <PlatformBillingPaymentsPage /> },
                { path: "inadimplencia", element: <PlatformBillingDelinquencyPage /> },
                { path: "pix", element: <PlatformBillingPixPage /> },
                { path: "eventos", element: <PlatformBillingEventsPage /> },
                { path: "relatorios", element: <PlatformBillingReportsPage /> },
                { path: "comercial", element: <PlatformBillingCommercialPage /> },
                { path: "acesso", element: <PlatformCommercialAccessPage /> },
                { path: "clinicas/:clinicId", element: <PlatformClinicBillingDetailPage /> },
              ],
            },
            { path: "configuracoes", element: <PlatformSettingsPage /> },
          ],
        },
        {
          // AppShell envolve o <Outlet/> num Suspense — cobre todas as páginas lazy protegidas.
          path: "/",
          element: (
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          ),
          children: [
            { index: true, element: <DashboardPage /> },
            { path: "pacientes", element: <PatientsPage /> },
            { path: "pacientes/:id", element: <PatientProfilePage /> },
            { path: "pacientes/:id/atendimento/:encounterId", element: <EncounterPage /> },
            { path: "jornada", element: <JourneyBoardPage /> },
            { path: "planos", element: <PlansPage /> },
            { path: "biblioteca", element: <ExerciseLibraryPage /> },
            { path: "mensagens", element: <MessagesPage /> },
            { path: "campanhas", element: <CampaignsPage /> },
            { path: "gestao", element: <ManagementPage /> },
            {
              // Financeiro com abas: Mensalidades (a tela de sempre) e Cadastros (Entrega 1 do módulo Financeiro/Estoque).
              path: "financeiro",
              element: <FinanceLayout />,
              children: [
                { index: true, element: <FinanceMensalidades /> },
                { path: "vendas", element: <SalesTab /> },
                { path: "atendimentos", element: <AppointmentsTab /> },
                { path: "pacotes", element: <PatientPackagesTab /> },
                {
                  path: "repasse",
                  element: <PayoutLayout />,
                  children: [
                    { index: true, element: <PayoutLinesTab /> },
                    { path: "regras", element: <PayoutRulesTab /> },
                    { path: "simulador", element: <PayoutSimulatorTab /> },
                  ],
                },
                { path: "titulos", element: <TitlesTab /> },
                { path: "caixa", element: <CashTab /> },
                {
                  path: "cadastros",
                  element: <CadastrosLayout />,
                  children: [
                    { path: "servicos", element: <ServicesTab /> },
                    { path: "pacotes", element: <PackagesTab /> },
                    { path: "profissionais", element: <ProfessionalsFinanceTab /> },
                    { path: "meios-de-pagamento", element: <PaymentMethodsTab /> },
                    { path: "impostos", element: <TaxSettingsTab /> },
                    { path: "historico", element: <AuditTab /> },
                  ],
                },
              ],
            },
            { path: "estoque", element: <StockPage /> },
            { path: "estoque/saldo", element: <StockBalanceTab /> },
            { path: "estoque/entradas", element: <StockEntriesTab /> },
            { path: "estoque/saidas", element: <StockExitsTab /> },
            { path: "estoque/movimentacoes", element: <StockMovementsTab /> },
            { path: "estoque/sem-saldo", element: <StockShortfallsTab /> },
            { path: "retencao", element: <RetentionPage /> },
            { path: "configuracoes", element: <SettingsPage /> },
            { path: "configuracoes/faturamento", element: <BillingProfilePage /> },
            { path: "configuracoes/equipe", element: <TeamAdminPage /> },
            { path: "configuracoes/unidades", element: <UnitsPage /> },
            { path: "configuracoes/disciplinas", element: <DisciplinesAdminPage /> },
            { path: "configuracoes/jornada", element: <JourneyColumnsAdminPage /> },
            { path: "configuracoes/auditoria", element: <ReportAuditPage /> },
            { path: "relatorios/lote", element: <BatchReportPage /> },
            { path: "*", element: <NotFoundPage /> },
          ],
        },
      ],
    },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
    },
  },
);
