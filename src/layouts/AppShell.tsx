import { Suspense } from "react";
import { Outlet } from "react-router-dom";

import { CommercialObserveBanner } from "@/components/billing/CommercialObserveBanner";
import { LoadingState } from "@/components/feedback/LoadingState";
import { VertexaAiProvider } from "@/components/vertexa-ai/VertexaAiProvider";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell() {
  return (
    <VertexaAiProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <CommercialObserveBanner />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-7xl px-4 py-5 md:px-[22px] md:py-[22px]">
              <Suspense fallback={<LoadingState />}>
                <Outlet />
              </Suspense>
            </div>
          </main>
        </div>
      </div>
    </VertexaAiProvider>
  );
}
