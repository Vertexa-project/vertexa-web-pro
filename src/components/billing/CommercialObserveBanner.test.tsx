import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const st = vi.hoisted(() => ({ admin: false }));
vi.mock("@/hooks/useCurrentProfessional", () => ({ useCurrentProfessional: () => ({ data: { clinicId: "c1" } }) }));
vi.mock("@/hooks/useCommercialAccess", () => ({ useMyClinicCommercialAccess: () => ({ data: { reason: "OBSERVE_ONLY" } }) }));
vi.mock("@/hooks/useIsClinicAdmin", () => ({ useIsClinicAdmin: () => ({ isClinicAdmin: st.admin }) }));
import { CommercialObserveBanner } from "./CommercialObserveBanner";

const view = () => render(<MemoryRouter><CommercialObserveBanner /></MemoryRouter>);

describe("CommercialObserveBanner", () => {
  it("não aparece para quem não é administrador da clínica", () => {
    st.admin = false;
    view();
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("aparece com o link de faturamento para o administrador", () => {
    st.admin = true;
    view();
    expect(screen.getByRole("status")).toHaveTextContent("contrato comercial");
    expect(screen.getByRole("link", { name: /Faturamento/ })).toBeInTheDocument();
  });
});
