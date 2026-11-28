import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/api/billingCheckout", () => ({
  createMyClinicCommercialContract: vi.fn(async () => ({})),
  getMyClinicCommercialCheckout: vi.fn(),
  listSellableBillingPlans: vi.fn(),
}));

import { useCreateClinicCommercialContract } from "./useBillingCheckout";
import { qk } from "@/lib/queryKeys";

describe("useCreateClinicCommercialContract (cartão 1568)", () => {
  it("atualiza o acesso comercial, que tira a faixa 'ainda não tem contrato'", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateClinicCommercialContract("c1"), { wrapper });
    result.current.mutate("v1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.clinicCommercialAccess("c1") });
  });
});
