import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ on: false, mutate: vi.fn() }));
vi.mock("@/hooks/useMedication", () => ({
  useMedSettings: () => ({ data: h.on, isLoading: false, isError: false }),
  useSetMedSettings: () => ({ mutate: h.mutate, isPending: false }),
}));
import { MedicationReminderRow } from "./MedicationReminderRow";

beforeEach(() => { h.on = false; h.mutate.mockClear(); });
describe("Configurações: lembrete de medicação", () => {
  it("nasce desligado e liga no clique", () => {
    render(<MedicationReminderRow clinicId="c" />);
    expect(screen.getByText("Desligado")).toBeInTheDocument();
    const sw = screen.getByRole("switch", { name: /Lembrete de aplicação/ });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(h.mutate).toHaveBeenCalledWith(true, expect.anything());
  });
  it("ligado desliga", () => {
    h.on = true;
    render(<MedicationReminderRow clinicId="c" />);
    expect(screen.getByText("Ligado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    expect(h.mutate).toHaveBeenCalledWith(false, expect.anything());
  });
});
