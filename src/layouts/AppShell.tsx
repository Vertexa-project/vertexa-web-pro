import { Suspense } from "react";
import { Outlet } from "react-router-dom";

import { CommercialObserveBanner } from "@/components/billing/CommercialObserveBanner";
import { LoadingState } from "@/components/feedback/LoadingState";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <CommercialObserveBanner />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
            <Suspense fallback={<LoadingState />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
