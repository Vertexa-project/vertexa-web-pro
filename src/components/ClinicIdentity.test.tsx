import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: null as null | Record<string, unknown> }));
vi.mock("@/hooks/useClinicBrand", () => ({ useClinicBrand: () => ({ data: state.data }) }));
const { ClinicIdentity } = await import("./ClinicIdentity");

const brand = (o: Record<string, unknown> = {}) => ({ clinicId: "c1", name: "Clínica Teste Hefesto", logoPath: null, color: null, logoUrl: null, ...o });
beforeEach(() => { state.data = null; });

describe("ClinicIdentity", () => {
  it("sem clínica resolvida: cai na marca Vertexa (sem nome de clínica)", () => {
    const { container } = render(<ClinicIdentity />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.queryByText(/via Vertexa/i)).toBeNull();
  });
  it("com logo: mostra a logo, o nome em destaque e a Vertexa como assinatura secundária", () => {
    state.data = brand({ logoUrl: "https://x/logo.png", logoPath: "c1/a.png" });
    render(<ClinicIdentity />);
    expect((screen.getByAltText("Logo de Clínica Teste Hefesto") as HTMLImageElement).src).toBe("https://x/logo.png");
    expect(screen.getByText("Clínica Teste Hefesto")).toBeTruthy();
    expect(screen.getByText(/via Vertexa/i)).toBeTruthy();
  });
  it("sem logo: iniciais com a cor da marca", () => {
    state.data = brand({ color: "#112233" });
    render(<ClinicIdentity />);
    const el = screen.getByText("CT");
    expect(el.style.backgroundColor).toBe("rgb(17, 34, 51)");
  });
  it("logo que falha ao carregar volta para as iniciais", () => {
    state.data = brand({ logoUrl: "https://x/quebrada.png", logoPath: "c1/a.png" });
    render(<ClinicIdentity />);
    fireEvent.error(screen.getByAltText("Logo de Clínica Teste Hefesto"));
    expect(screen.queryByAltText("Logo de Clínica Teste Hefesto")).toBeNull();
    expect(screen.getByText("CT")).toBeTruthy();
  });
  it("modo compacto não mostra o nome", () => {
    state.data = brand();
    render(<ClinicIdentity compact />);
    expect(screen.queryByText("Clínica Teste Hefesto")).toBeNull();
  });
});
