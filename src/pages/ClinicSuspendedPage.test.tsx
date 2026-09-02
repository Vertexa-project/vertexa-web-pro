import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/providers/auth-context", () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}));
vi.mock("@/hooks/useIdentity", () => ({
  useIdentity: () => ({ email: "pro@t.test" }),
}));

const { ClinicSuspendedPage } = await import("./ClinicSuspendedPage");

describe("ClinicSuspendedPage — S29", () => {
  it("explica a suspensão sem motivo administrativo e oferece logout", () => {
    render(
      <MemoryRouter>
        <ClinicSuspendedPage
          clinics={[
            {
              clinicId: "c1",
              clinicName: "Clínica Horizonte",
              status: "active",
              clinicStatus: "suspended",
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Esta clínica está temporariamente suspensa")).toBeInTheDocument();
    expect(screen.getByText(/dados permanecem preservados/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
    expect(screen.queryByText(/inadimpl/i)).not.toBeInTheDocument();
  });
});
