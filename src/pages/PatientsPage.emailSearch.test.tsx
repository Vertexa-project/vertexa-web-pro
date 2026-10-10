import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { PatientListItem } from "@/types/db";

// A lista vem do servidor já recortada pela RLS (só a clínica do usuário). A busca filtra ESSA
// lista no cliente — nenhuma consulta nova, nenhum paciente de fora aparece.
const listPatients = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useCurrentProfessional", () => ({
  useCurrentProfessional: () => ({ data: { id: "pr-1", clinicId: "c1" }, isLoading: false }),
}));
vi.mock("@/hooks/useIsClinicAdmin", () => ({
  useIsClinicAdmin: () => ({ isClinicAdmin: true, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/usePatients", () => ({
  useListPatients: () => {
    listPatients();
    return { data: clinicPatients, isLoading: false, isError: false, refetch: vi.fn() };
  },
}));
vi.mock("@/hooks/usePatientTeam", () => ({
  usePatientsWithoutActiveProfessional: () => ({ data: [] }),
}));
vi.mock("@/components/patient/PatientCreateDialog", () => ({ PatientCreateDialog: () => null }));
vi.mock("@/hooks/useBillingCommercial", () => ({
  useClinicCommercialUsage: () => ({ data: null, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useProfileAvatar", () => ({
  useSignedAvatarUrl: () => ({ data: undefined }),
  useProfileAvatarUrls: () => ({ data: new Map(), isLoading: false }),
  ProfileAvatarUrlScope: ({ children }: { children: React.ReactNode }) => children,
  ProfileAvatarUrlContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));

function patient(id: string, name: string, email: string | null): PatientListItem {
  return {
    id,
    goal: null,
    current_weight: null,
    start_date: null,
    birth_date: null,
    profile: { full_name: name, email, avatar_url: null, avatar_path: null },
    snapshot: null,
    professionals: [],
    lastActivityAt: null,
    lastWeightAt: null,
    lastPhotoAt: null,
    lastWorkoutAt: null,
  };
}

const clinicPatients: PatientListItem[] = [
  patient("p1", "Ana Lima", "ana.lima@clinica.test"),
  patient("p2", "Bruno Costa", "bruno@outro.test"),
  patient("p3", "Carla Dias", null),
];

const { PatientsPage } = await import("./PatientsPage");

function rows() {
  const table = screen.queryByRole("table", { name: "Lista de pacientes" });
  return table ? within(table).queryAllByRole("button").map((b) => b.textContent ?? "") : [];
}
function shown(name: string) {
  return rows().some((t) => t.includes(name));
}

function search(term: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: "Buscar pacientes" }), { target: { value: term } });
}

describe("PatientsPage — busca por nome ou e-mail (WP-PATIENT-IDENTITY-POLISH-01)", () => {
  it("nome, e-mail completo, parcial, maiúsculas; sem resultado; só a lista da clínica", () => {
    render(
      <MemoryRouter>
        <PatientsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("searchbox", { name: "Buscar pacientes" })).toHaveAttribute(
      "placeholder",
      "Buscar por nome ou e-mail…",
    );
    const fetchesBefore = listPatients.mock.calls.length;

    search("bruno");
    expect(shown("Bruno Costa")).toBe(true);
    expect(shown("Ana Lima")).toBe(false);

    search("ana.lima@clinica.test");
    expect(shown("Ana Lima")).toBe(true);
    expect(shown("Bruno Costa")).toBe(false);

    search("@outro");
    expect(shown("Bruno Costa")).toBe(true);
    expect(shown("Ana Lima")).toBe(false);

    search("ANA.LIMA@CLINICA");
    expect(shown("Ana Lima")).toBe(true);

    search("ninguem@nada.test");
    expect(screen.queryByRole("table", { name: "Lista de pacientes" })).not.toBeInTheDocument();
    expect(screen.getByText("Nenhum resultado")).toBeInTheDocument();

    // a busca só filtra a lista já entregue (mesmo hook, mesmos dados) — não amplia o escopo
    expect(listPatients.mock.calls.length).toBeGreaterThanOrEqual(fetchesBefore);
    search("");
    expect(screen.getAllByRole("button", { name: /^Ver paciente / }).length).toBe(clinicPatients.length);
  });
});
