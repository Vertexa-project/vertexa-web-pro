import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Série: última medida = 108 kg. Cadastro diz 117 (current_weight) — telas devem mostrar 108.
vi.mock("./docimport/DocImportSection", () => ({ DocImportSection: () => null })); // importação com Conferência tem teste próprio
vi.mock("@/lib/api/weight", () => ({
  getWeightSeries: vi.fn(async () => [
    { date: "2026-09-01T12:00:00Z", weight: 117, source: "app", method: null },
    { date: "2026-10-20T12:00:00Z", weight: 108, source: "assessment", method: "manual" },
  ]),
  getPendingWeights: vi.fn(async () => []),
  getWeightLogs: vi.fn(async () => []),
  reviewWeightLog: vi.fn(),
}));
vi.mock("@/lib/api/assessments", () => ({
  getBodyAssessments: vi.fn(async () => []),
  getPatientDocuments: vi.fn(async () => []),
  getProgressPhotosWithUrls: vi.fn(async () => []),
}));
vi.mock("@/hooks/useHydration", () => ({ useHydrationToday: () => ({ data: 0.25, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("./AssessmentsSection", () => ({ AssessmentsSection: () => null }));
vi.mock("./WeightReviewCard", () => ({ WeightReviewCard: () => null }));
vi.mock("./PhotosSection", () => ({ PhotosSection: () => null }));
vi.mock("./ExportEvolutionButton", () => ({ ExportEvolutionButton: () => null }));
vi.mock("@/components/charts/WeightChart", () => ({ WeightChart: () => null }));

import { AnthropometryTab } from "./AnthropometryTab";
import { EvolutionTab } from "./EvolutionTab";
import type { PatientDetail } from "@/types/db";

const patient = { id: "p1", height_cm: 1.81, start_weight: 120, current_weight: 117, target_weight: 100 } as unknown as PatientDetail;
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("peso do paciente: fonte única", () => {
  it("Antropometria: peso 108, IMC 33,0 (altura em metros) e hidratação 0,25 L", async () => {
    wrap(<AnthropometryTab patient={patient} />);
    expect(await screen.findByText("108 kg")).toBeInTheDocument();
    expect(screen.getByText("33,0")).toBeInTheDocument();
    expect(screen.getByText("0,25 L")).toBeInTheDocument();
    expect(screen.queryByText(/329660/)).toBeNull();
  });
  it("Evolução: atual 108 e variação −9 kg (última − primeira válida)", async () => {
    wrap(<EvolutionTab patient={patient} />);
    expect(await screen.findByText("108 kg")).toBeInTheDocument();
    expect(screen.getByText("−9 kg")).toBeInTheDocument();
    expect(screen.getAllByText("117 kg").length).toBe(1); // só o "inicial" (primeira válida)
  });
});
