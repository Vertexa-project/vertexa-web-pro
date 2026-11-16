import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/providers/auth-context", () => ({ useAuth: () => ({ signOut: vi.fn(), session: { user: { email: "a@b.c" } } }) }));
vi.mock("@/providers/theme-context", () => ({ useTheme: () => ({ resolvedTheme: "light", toggleTheme: vi.fn() }) }));
vi.mock("@/providers/role-context", () => ({ useRole: () => ({ roleLabel: "Admin" }) }));
vi.mock("@/hooks/useIdentity", () => ({ useIdentity: () => ({ status: "active", displayName: "Ana", actingProfileId: "x" }) }));
vi.mock("@/hooks/useProfileAvatar", () => ({ useMyProfileAvatar: () => ({ data: null }) }));
vi.mock("./MobileNav", () => ({ MobileNav: () => null }));
vi.mock("@/components/ClinicIdentity", () => ({ ClinicIdentity: () => null }));
vi.mock("@/components/notifications/StaffNotificationsBell", () => ({ StaffNotificationsBell: () => null }));
vi.mock("@/components/avatar/ProfilePhoto", () => ({ ProfilePhoto: () => null }));
import { Topbar } from "./Topbar";

describe("Topbar", () => {
  it("não mostra a busca 'em breve'", () => {
    render(<MemoryRouter><Topbar /></MemoryRouter>);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByPlaceholderText(/Buscar/)).toBeNull();
  });
});
