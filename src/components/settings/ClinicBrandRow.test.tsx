import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ save: vi.fn(), data: null as null | Record<string, unknown> }));
vi.mock("@/lib/api/clinicBrand", () => ({ saveClinicBrand: h.save }));
vi.mock("@/hooks/useClinicBrand", () => ({
  CLINIC_BRAND_KEY: ["clinicBrand", "mine"],
  useClinicBrand: () => ({ data: h.data, isLoading: false }),
}));
const { ClinicBrandRow } = await import("./ClinicBrandRow");

const base = { clinicId: "c1", name: "Clínica Teste", logoPath: "c1/old.png", color: "#112233", logoUrl: "https://x/old.png" };
const png = (size = 100) => new File([new Uint8Array(size)], "logo.png", { type: "image/png" });
const renderRow = () => render(<QueryClientProvider client={new QueryClient()}><ClinicBrandRow /></QueryClientProvider>);

beforeEach(() => {
  h.save.mockReset();
  h.data = { ...base };
  Object.defineProperty(URL, "createObjectURL", { value: () => "blob:preview", configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, configurable: true });
});

describe("ClinicBrandRow", () => {
  it("sem alteração, Salvar fica desabilitado", () => {
    renderRow();
    expect((screen.getByRole("button", { name: /Salvar identidade/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("arquivo inválido é recusado antes de enviar", async () => {
    renderRow();
    await userEvent.upload(screen.getByLabelText("Logo da clínica"), new File([new Uint8Array(5)], "x.pdf", { type: "application/pdf" }), { applyAccept: false });
    expect((await screen.findByRole("alert")).textContent).toMatch(/PNG, JPG ou WebP/);
    expect(h.save).not.toHaveBeenCalled();
  });
  it("cor inválida bloqueia o salvamento", () => {
    renderRow();
    fireEvent.change(screen.getByPlaceholderText("#RRGGBB"), { target: { value: "azul" } });
    expect((screen.getByRole("button", { name: /Salvar identidade/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("logo nova + cor: envia clinicId, logo atual, arquivo e cor normalizada", async () => {
    h.save.mockResolvedValue(undefined);
    renderRow();
    const f = png();
    await userEvent.upload(screen.getByLabelText("Logo da clínica"), f);
    fireEvent.change(screen.getByPlaceholderText("#RRGGBB"), { target: { value: "ff6600" } });
    await userEvent.click(screen.getByRole("button", { name: /Salvar identidade/ }));
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0][0]).toMatchObject({ clinicId: "c1", currentLogoPath: "c1/old.png", newLogo: f, removeLogo: false, color: "#FF6600" });
    expect(h.save.mock.calls[0][0].newLogo).toBe(f);
    expect((await screen.findByRole("status")).textContent).toMatch(/salva/);
  });
  it("remover logo envia removeLogo=true", async () => {
    h.save.mockResolvedValue(undefined);
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: /Remover logo/ }));
    await userEvent.click(screen.getByRole("button", { name: /Salvar identidade/ }));
    await waitFor(() => expect(h.save).toHaveBeenCalled());
    expect(h.save.mock.calls[0][0]).toMatchObject({ removeLogo: true, newLogo: null });
  });
  it("falha do servidor mostra erro e não afirma sucesso", async () => {
    h.save.mockRejectedValue(new Error("boom"));
    renderRow();
    await userEvent.upload(screen.getByLabelText("Logo da clínica"), png());
    await userEvent.click(screen.getByRole("button", { name: /Salvar identidade/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Não foi possível salvar/);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
