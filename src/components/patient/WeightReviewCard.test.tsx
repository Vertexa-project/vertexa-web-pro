import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  pending: [] as { id: string; weight_kg: number; measured_at: string }[],
  review: vi.fn(async () => undefined),
}));
vi.mock("@/lib/api/weight", () => ({
  getPendingWeights: vi.fn(async () => api.pending),
  getWeightSeries: vi.fn(async () => [{ date: "2026-10-16T12:00:00Z", weight: 70.3, source: "app", method: null }]),
  reviewWeightLog: api.review,
}));

import { WeightReviewCard } from "./WeightReviewCard";
const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WeightReviewCard patientId="p1" /></QueryClientProvider>);
beforeEach(() => { api.pending = []; api.review.mockClear(); });

describe("WeightReviewCard", () => {
  it("sem pendência: não aparece", async () => {
    const { container } = wrap();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
  it("mostra o valor, a variação e decide aprovar/recusar", async () => {
    api.pending = [{ id: "w1", weight_kg: 58, measured_at: "2026-10-21T12:00:00Z" }];
    wrap();
    expect(await screen.findByText(/−12,3 kg desde 16\/10/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aprovar peso 58 kg" }));
    await waitFor(() => expect(api.review).toHaveBeenCalledWith("w1", "approved"));
    fireEvent.click(screen.getByRole("button", { name: "Recusar peso 58 kg" }));
    await waitFor(() => expect(api.review).toHaveBeenCalledWith("w1", "rejected"));
  });
});
