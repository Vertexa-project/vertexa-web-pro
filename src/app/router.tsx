import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";

import { AppShell } from "@/layouts/AppShell";
import { LoadingState } from "@/components/feedback/LoadingState";
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
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })));

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
        { path: "planos", element: <PlansPage /> },
        { path: "mensagens", element: <MessagesPage /> },
        { path: "campanhas", element: <CampaignsPage /> },
        { path: "retencao", element: <RetentionPage /> },
        { path: "configuracoes", element: <SettingsPage /> },
        { path: "configuracoes/disciplinas", element: <DisciplinesAdminPage /> },
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
