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
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const PatientsPage = lazy(() => import("@/pages/PatientsPage").then((m) => ({ default: m.PatientsPage })));
const PatientProfilePage = lazy(() =>
  import("@/pages/PatientProfilePage").then((m) => ({ default: m.PatientProfilePage })),
);
const PlansPage = lazy(() => import("@/pages/PlansPage").then((m) => ({ default: m.PlansPage })));
const MessagesPage = lazy(() => import("@/pages/MessagesPage").then((m) => ({ default: m.MessagesPage })));
const CampaignsPage = lazy(() => import("@/pages/CampaignsPage").then((m) => ({ default: m.CampaignsPage })));
const ManagementPage = lazy(() => import("@/pages/ManagementPage").then((m) => ({ default: m.ManagementPage })));
const FinancePage = lazy(() => import("@/pages/FinancePage").then((m) => ({ default: m.FinancePage })));
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
            { path: "jornada", element: <JourneyBoardPage /> },
            { path: "planos", element: <PlansPage /> },
            { path: "mensagens", element: <MessagesPage /> },
            { path: "campanhas", element: <CampaignsPage /> },
            { path: "gestao", element: <ManagementPage /> },
            { path: "financeiro", element: <FinancePage /> },
            { path: "retencao", element: <RetentionPage /> },
            { path: "configuracoes", element: <SettingsPage /> },
            { path: "configuracoes/faturamento", element: <BillingProfilePage /> },
            { path: "configuracoes/equipe", element: <TeamAdminPage /> },
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
