import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useCreateOwnClinic", () => ({
  useCreateOwnClinic: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

const { CreateClinicForm } = await import("./CreateClinicForm");

function renderForm(props: { defaultName?: string; nameLocked?: boolean }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CreateClinicForm {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CreateClinicForm", () => {
  it("nome aprovado fica somente leitura", () => {
    renderForm({ defaultName: "Clínica Alpha", nameLocked: true });
    const input = screen.getByLabelText(/nome da clínica/i);
    expect(input).toHaveAttribute("readonly");
    expect(screen.getByText(/nome aprovado na análise/i)).toBeInTheDocument();
  });
});
