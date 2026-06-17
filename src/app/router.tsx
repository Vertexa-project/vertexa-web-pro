import { createBrowserRouter } from "react-router-dom";

import { AppShell } from "@/layouts/AppShell";
import { ProtectedRoute } from "./ProtectedRoute";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { PatientsPage } from "@/pages/PatientsPage";
import { PatientProfilePage } from "@/pages/PatientProfilePage";
import { PlansPage } from "@/pages/PlansPage";
import { MessagesPage } from "@/pages/MessagesPage";
import { CampaignsPage } from "@/pages/CampaignsPage";
import { RetentionPage } from "@/pages/RetentionPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
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
      { path: "*", element: <NotFoundPage /> },
    ],
  },
], {
  future: {
    v7_relativeSplatPath: true,
  },
});
