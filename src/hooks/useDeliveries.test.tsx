import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/lib/api/deliveries", () => ({
  listDeliveries: vi.fn(),
  revokeDelivery: vi.fn(),
  sendDocumentToPatient: vi.fn(),
  savePdfAndSend: h.save,
}));

import { useSendPdf } from "./useDeliveries";

describe("envio ao paciente não espera o recarregamento das listas", () => {
  it("a mutação termina mesmo que as listas demorem para recarregar (invalidate não é aguardado)", async () => {
    h.save.mockResolvedValue({ documentId: "d", deliveryId: "x" });
    const qc = new QueryClient();
    const calls: unknown[] = [];
    qc.invalidateQueries = ((f: unknown) => { calls.push(f); return new Promise(() => undefined); }) as never; // nunca resolve
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useSendPdf("p1"), { wrapper });
    const input = { patientId: "p1", professionalId: "pr", blob: new Blob(["x"]), fileName: "a.pdf", kind: "treino" as const, title: "t" };
    const done = vi.fn();
    result.current.mutate(input, { onSuccess: done });
    await waitFor(() => expect(done).toHaveBeenCalled(), { timeout: 500 });
    expect(calls).toHaveLength(2); // lista de envios e de exames são atualizadas em segundo plano
  });
});
