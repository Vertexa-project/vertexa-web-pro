import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("./docimport/PdfPagesPreview", () => ({ PdfPagesPreview: () => <div data-testid="pdf-preview" /> }));
vi.mock("@/hooks/useDeliveries", () => ({ useSendPdf: () => ({ mutate: h.mutate, isPending: false }) }));
vi.mock("@/lib/observability/sentry", () => ({ captureException: vi.fn() }));

import { SendToPatientDialog } from "./SendToPatientDialog";

beforeEach(() => h.mutate.mockReset());

function setup(extra: object = {}) {
  const blob = new Blob(["%PDF"], { type: "application/pdf" });
  (blob as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer = () => Promise.resolve(new ArrayBuffer(4));
  const build = vi.fn().mockResolvedValue(blob);
  const onOpenChange = vi.fn();
  const onSent = vi.fn();
  render(<SendToPatientDialog open onOpenChange={onOpenChange} kind="plano_alimentar" patientId="p1" patientName="Ana Teste" professionalId="pr1" planTitle="Plano" build={build} onSent={onSent} {...extra} />);
  return { build, onOpenChange, onSent, blob };
}

describe("SendToPatientDialog", () => {
  it("monta o PDF uma vez ao abrir e envia ESSE mesmo arquivo (sem gerar de novo)", async () => {
    const { build, blob } = setup();
    await screen.findByTestId("pdf-preview");
    fireEvent.click(screen.getByRole("button", { name: /Enviar ao app do paciente/ }));
    expect(build).toHaveBeenCalledTimes(1);
    expect(h.mutate.mock.calls[0][0]).toMatchObject({ patientId: "p1", professionalId: "pr1", kind: "plano_alimentar" });
    expect(h.mutate.mock.calls[0][0].blob).toBe(blob);
  });
  it("depois de enviar o diálogo fecha sozinho e o aviso vai para a tela", async () => {
    const { onOpenChange, onSent } = setup();
    await screen.findByTestId("pdf-preview");
    fireEvent.click(screen.getByRole("button", { name: /Enviar ao app do paciente/ }));
    h.mutate.mock.calls[0][1].onSuccess();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSent).toHaveBeenCalledWith(expect.stringContaining("Enviado"));
    expect(screen.queryByText(/^Enviado/)).toBeNull(); // nada de "Enviado + Fechar" dentro do diálogo
  });
  it("enquanto monta mostra esqueleto, não tela vazia", () => {
    setup({ build: () => new Promise(() => undefined) });
    expect(screen.getByTestId("pdf-building")).toBeInTheDocument();
  });
});
