import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ deleteUnusedPatientRegistration: vi.fn() }));
vi.mock("@/lib/api/patients", () => ({
  createPatient: vi.fn(),
  getPatient: vi.fn(),
  getPatientDeletionEligibility: vi.fn(),
  getPatientRegistrationAccess: vi.fn(),
  listPatients: vi.fn(),
  updatePatientRegistration: vi.fn(),
  deleteUnusedPatientRegistration: api.deleteUnusedPatientRegistration,
}));

const { useDeleteUnusedPatientRegistration } = await import("./usePatients");
const { qk } = await import("@/lib/queryKeys");

describe("useDeleteUnusedPatientRegistration", () => {
  it("após excluir: invalida a lista e NÃO remove o cache da ficha (quem descarta é a ficha, ao desmontar)", async () => {
    api.deleteUnusedPatientRegistration.mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(qk.patients, [{ id: "pat-1" }, { id: "pat-2" }]);
    qc.setQueryData(qk.patient("pat-1"), { id: "pat-1" });
    qc.setQueryData(qk.patientDeletionEligibility("pat-1"), { eligible: true });
    qc.setQueryData(qk.patient("pat-2"), { id: "pat-2" });
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDeleteUnusedPatientRegistration(), { wrapper });

    await act(async () => {
      result.current.mutate("pat-1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.deleteUnusedPatientRegistration).toHaveBeenCalledWith("pat-1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.patients });
    // remover aqui faria a ficha ainda montada buscar o paciente excluído (406) — ver
    // PatientProfilePage.deleteLifecycle.test.tsx
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: qk.patient("pat-1") });
    expect(qc.getQueryData(qk.patient("pat-1"))).toEqual({ id: "pat-1" });
    expect(qc.getQueryData(qk.patient("pat-2"))).toEqual({ id: "pat-2" });
  });
});
