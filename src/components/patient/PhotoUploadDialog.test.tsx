import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock("@/hooks/useBodyAssessments", () => ({
  useUploadProgressPhoto: () => ({ mutateAsync: state.mutateAsync, isPending: state.isPending }),
}));

const { PhotoUploadDialog } = await import("./PhotoUploadDialog");

const jpg = () => new File([new Uint8Array(10)], "antiga.jpg", { type: "image/jpeg" });
const pdf = () => new File([new Uint8Array(10)], "x.pdf", { type: "application/pdf" });

function setup(onOpenChange = vi.fn()) {
  render(<PhotoUploadDialog patientId="pat-1" open onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

beforeEach(() => {
  state.mutateAsync.mockReset();
  state.isPending = false;
});

describe("PhotoUploadDialog — envio de foto antiga pelo profissional", () => {
  it("sem arquivo: avisa e não envia", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Enviar foto/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Escolha a foto/);
    expect(state.mutateAsync).not.toHaveBeenCalled();
  });

  it("arquivo que não é imagem é recusado antes de enviar", async () => {
    setup();
    await userEvent.upload(screen.getByLabelText("Foto"), pdf(), { applyAccept: false });
    await userEvent.click(screen.getByRole("button", { name: /Enviar foto/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Formato não suportado/);
    expect(state.mutateAsync).not.toHaveBeenCalled();
  });

  it("data futura é recusada", async () => {
    setup();
    await userEvent.upload(screen.getByLabelText("Foto"), jpg());
    const day = screen.getByLabelText("Data da foto") as HTMLInputElement;
    await userEvent.clear(day);
    await userEvent.type(day, "2999-01-01");
    await userEvent.click(screen.getByRole("button", { name: /Enviar foto/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/futuro/);
    expect(state.mutateAsync).not.toHaveBeenCalled();
  });

  it("envio válido: manda arquivo, data retroativa e posição; fecha o diálogo", async () => {
    state.mutateAsync.mockResolvedValue("photo-id");
    const { onOpenChange } = setup();
    await userEvent.upload(screen.getByLabelText("Foto"), jpg());
    const day = screen.getByLabelText("Data da foto") as HTMLInputElement;
    await userEvent.clear(day);
    await userEvent.type(day, "2026-03-10");
    await userEvent.click(screen.getByRole("button", { name: /Enviar foto/i }));
    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledTimes(1));
    const arg = state.mutateAsync.mock.calls[0][0] as { file: File; takenOn: string; pose: string | null };
    expect(arg.file.name).toBe("antiga.jpg");
    expect(arg.takenOn).toBe("2026-03-10");
    expect(arg.pose).toBeNull(); // padrão "Sem posição" até o profissional escolher
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("erro do servidor aparece traduzido e o diálogo continua aberto", async () => {
    state.mutateAsync.mockRejectedValue({ hint: "PHOTO_NOT_AUTHORIZED" });
    const { onOpenChange } = setup();
    await userEvent.upload(screen.getByLabelText("Foto"), jpg());
    await userEvent.click(screen.getByRole("button", { name: /Enviar foto/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/não tem permissão/i);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
