import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api/timeline", () => ({
  getPatientTimeline: vi.fn(async () => [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `w${i}`, patient_id: "p", type: "hydration_logged", payload: { liters: 0.25 }, created_at: `2026-11-12T1${i}:00:00Z` })),
    { id: "m1", patient_id: "p", type: "meal_logged", payload: null, created_at: "2026-11-12T12:00:00Z" },
    { id: "d1", patient_id: "p", type: "mood_logged", payload: null, created_at: "2026-11-12T13:00:00Z" },
    { id: "s1", patient_id: "p", type: "document_signed", payload: { doc_type: "receita" }, created_at: "2026-11-12T20:00:00Z" },
  ]),
}));
import { TimelineTab } from "./TimelineTab";

describe("TimelineTab", () => {
  it("agrupa hábitos do dia em português e mantém documentos", async () => {
    render(<QueryClientProvider client={new QueryClient()}><TimelineTab patientId="p" /></QueryClientProvider>);
    expect(await screen.findByText("Hábitos do dia")).toBeInTheDocument();
    expect(screen.getByText(/Água 1,25 L em 5 registros/)).toBeInTheDocument();
    expect(screen.getAllByText("Hábitos do dia")).toHaveLength(1);
    expect(screen.getByText("Documento assinado")).toBeInTheDocument();
    expect(screen.queryByText(/meal logged|mood logged/i)).toBeNull();
  });
});
