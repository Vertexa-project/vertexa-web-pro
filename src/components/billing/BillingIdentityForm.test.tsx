import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mutate = vi.fn();
vi.mock("@/hooks/useBillingProfile", () => ({
  useClinicBillingIdentity: () => ({
    data: {
      exists: true,
      legalName: "QA TESTE Clinica",
      taxId: "11222333000181",
      taxIdMasked: "11.***.***/0001-81",
      email: "qa@example.com",
      mobilePhone: "11999990000",
    },
    isLoading: false,
    isError: false,
  }),
  useUpsertClinicBillingIdentity: () => ({ mutate, isPending: false }),
}));

import { BillingIdentityForm } from "./BillingIdentityForm";

describe("BillingIdentityForm — Editar (cartão 1568)", () => {
  beforeEach(() => mutate.mockReset());

  it("Editar destrava os campos e não envia o formulário", () => {
    render(<BillingIdentityForm clinicId="c1" />);
    expect(screen.getByLabelText("Razão social / nome legal")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Razão social / nome legal")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar dados de cobrança" })).toBeInTheDocument();
  });
});
