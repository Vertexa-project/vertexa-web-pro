import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useCurrentProfessional", () => ({
  useCurrentProfessional: () => ({ data: { clinicId: "c1" }, isLoading: false }),
}));
vi.mock("@/hooks/useIsClinicAdmin", () => ({
  useIsClinicAdmin: () => ({ isClinicAdmin: true, isLoading: false, isError: false }),
}));

const { CommercialActivationPage } = await import("./CommercialActivationPage");

describe("CommercialActivationPage", () => {
  it("asks the clinic to activate a plan without implying payment or Pix", () => {
    render(
      <MemoryRouter>
        <CommercialActivationPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Para continuar usando os recursos da clínica/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Faturamento \/ Planos/i })).toHaveAttribute(
      "href",
      "/configuracoes/faturamento",
    );
    expect(screen.queryByText(/pagamento recebido/i)).toBeInTheDocument();
    expect(screen.queryByText(/NO_ACTIVE_CONTRACT/)).not.toBeInTheDocument();
  });
});
