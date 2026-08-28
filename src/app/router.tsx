import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";

import { AppShell } from "@/layouts/AppShell";
import { PlatformShell } from "@/layouts/PlatformShell";
import { LoadingState } from "@/components/feedback/LoadingState";
import { AccessResolver } from "./AccessResolver";
import { AuthGate } from "./AuthGate";
import { PlatformAdminGate } from "./PlatformAdminGate";
import { ProtectedRoute } from "./ProtectedRoute";

// Code-splitting por rota: cada página vira um chunk próprio (recharts/editores fora do bundle inicial).
const LoginPage = lazy(() => import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const AuthCallback = lazy(() => import("@/app/AuthCallback").then((m) => ({ default: m.AuthCallback })));
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const PatientsPage = lazy(() => import("@/pages/PatientsPage").then((m) => ({ default: m.PatientsPage })));
const PatientProfilePage = lazy(() =>
  import("@/pages/PatientProfilePage").then((m) => ({ default: m.PatientProfilePage })),
);
const PlansPage = lazy(() => import("@/pages/PlansPage").then((m) => ({ default: m.PlansPage })));
const MessagesPage = lazy(() => import("@/pages/MessagesPage").then((m) => ({ default: m.MessagesPage })));
const CampaignsPage = lazy(() => import("@/pages/CampaignsPage").then((m) => ({ default: m.CampaignsPage })));
const RetentionPage = lazy(() => import("@/pages/RetentionPage").then((m) => ({ default: m.RetentionPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
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
const PlatformClinicsPage = lazy(() =>
  import("@/pages/PlatformClinicsPage").then((m) => ({ default: m.PlatformClinicsPage })),
);

export const router = createBrowserRouter(
  [
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
      children: [{ index: true, element: <PlatformClinicsPage /> }],
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
        { path: "retencao", element: <RetentionPage /> },
        { path: "configuracoes", element: <SettingsPage /> },
        { path: "configuracoes/equipe", element: <TeamAdminPage /> },
        { path: "configuracoes/disciplinas", element: <DisciplinesAdminPage /> },
        { path: "configuracoes/jornada", element: <JourneyColumnsAdminPage /> },
        { path: "configuracoes/auditoria", element: <ReportAuditPage /> },
        { path: "relatorios/lote", element: <BatchReportPage /> },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
    },
  },
);
