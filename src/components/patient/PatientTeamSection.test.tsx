import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProfessionalWithDisciplines } from "@/lib/api/disciplines";
import type { PatientTeamMember } from "@/lib/api/patientTeam";

const state = vi.hoisted(() => ({
  isClinicAdmin: true,
  adminLoading: false,
  team: [] as PatientTeamMember[],
  clinic: [] as ProfessionalWithDisciplines[],
  assignPending: false,
  deactivatePending: false,
  reactivatePending: false,
}));

const assignMutate = vi.hoisted(() =>
  vi.fn((_vars: unknown, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => {
    opts?.onSuccess?.();
  }),
);
const deactivateMutate = vi.hoisted(() =>
  vi.fn((_vars: unknown, opts?: { onSettled?: () => void }) => {
    opts?.onSettled?.();
  }),
);
const reactivateMutate = vi.hoisted(() =>
  vi.fn((_vars: unknown, opts?: { onSettled?: () => void }) => {
    opts?.onSettled?.();
  }),
);

vi.mock("@/hooks/useIsClinicAdmin", () => ({
  useIsClinicAdmin: () => ({
    isClinicAdmin: state.isClinicAdmin,
    isLoading: state.adminLoading,
    isError: false,
  }),
}));
vi.mock("@/hooks/usePatientTeam", () => ({
  usePatientTeam: () => ({
    data: state.team,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useDeactivatePatientLink: () => ({ mutate: deactivateMutate, isPending: state.deactivatePending }),
  useReactivatePatientLink: () => ({ mutate: reactivateMutate, isPending: state.reactivatePending }),
  useAssignPatientProfessional: () => ({ mutate: assignMutate, isPending: state.assignPending }),
}));
vi.mock("@/hooks/useDisciplines", () => ({
  useClinicProfessionalDisciplines: () => ({
    data: state.clinic,
    isLoading: false,
    isError: false,
  }),
  useDisciplinesList: () => ({
    data: [
      { code: "medico", label: "Médica" },
      { code: "nutricionista", label: "Nutricionista" },
    ],
  }),
}));
vi.mock("@/lib/observability/sentry", () => ({ captureException: vi.fn() }));
vi.mock("@/hooks/useProfileAvatar", () => ({
  useSignedAvatarUrl: (path?: string | null) => ({
    data: path ? `https://signed.test/${path}` : undefined,
  }),
  useProfileAvatarUrls: (paths: Array<string | null | undefined>) => ({
    data: new Map(
      paths.filter((p): p is string => Boolean(p)).map((p) => [p, `https://signed.test/${p}`]),
    ),
    isLoading: false,
  }),
  ProfileAvatarUrlScope: ({ children }: { children: React.ReactNode }) => children,
  ProfileAvatarUrlContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));

const { PatientTeamSection } = await import("./PatientTeamSection");

function teamMember(over: Partial<PatientTeamMember> = {}): PatientTeamMember {
  return {
    linkId: "l1",
    professionalId: "pr-ana",
    type: "doctor",
    fullName: "Ana Prado",
    isExternal: false,
    status: "active",
    statusChangedAt: null,
    statusChangedByName: null,
    statusReason: null,
    avatarPath: null,
    avatarUrl: null,
    ...over,
  };
}

function clinicPro(over: Partial<ProfessionalWithDisciplines> = {}): ProfessionalWithDisciplines {
  return {
    professionalId: "pr-carlos",
    profileId: "pf-carlos",
    fullName: "Carlos Lima",
    type: "nutritionist",
    status: "active",
    disciplines: ["nutricionista"],
    ...over,
  };
}

function renderSection() {
  return render(<PatientTeamSection patientId="pat-1" clinicId="cli-1" />);
}

beforeEach(() => {
  state.isClinicAdmin = true;
  state.adminLoading = false;
  state.team = [teamMember()];
  state.clinic = [clinicPro(), clinicPro({ professionalId: "pr-ana", fullName: "Ana Prado", disciplines: ["medico"] })];
  state.assignPending = false;
  state.deactivatePending = false;
  state.reactivatePending = false;
  assignMutate.mockClear();
  deactivateMutate.mockClear();
  reactivateMutate.mockClear();
  assignMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: () => void }) => {
    opts?.onSuccess?.();
  });
});

describe("botão Adicionar profissional", () => {
  it("admin vê o botão", () => {
    renderSection();
    expect(screen.getByRole("button", { name: /adicionar profissional/i })).toBeInTheDocument();
  });

  it("profissional comum NÃO vê o botão", () => {
    state.isClinicAdmin = false;
    renderSection();
    expect(screen.queryByRole("button", { name: /adicionar profissional/i })).not.toBeInTheDocument();
    expect(screen.getByText(/somente leitura/i)).toBeInTheDocument();
  });
});

describe("dialog de atribuição", () => {
  it("abre e lista elegíveis da clínica", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: /adicionar profissional/i }));
    expect(screen.getByRole("heading", { name: /adicionar profissional/i })).toBeInTheDocument();
    expect(screen.getByText("Carlos Lima")).toBeInTheDocument();
  });

  it("não oferece quem já está vinculado ativo", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: /adicionar profissional/i }));
    expect(screen.queryByRole("button", { name: /ana prado/i })).not.toBeInTheDocument();
  });

  it("não oferece profissional inativo na clínica", async () => {
    state.clinic = [clinicPro({ status: "inactive", fullName: "Inativo Silva" })];
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: /adicionar profissional/i }));
    expect(screen.queryByText("Inativo Silva")).not.toBeInTheDocument();
  });

  it("mostra múltiplas disciplinas com ·", async () => {
    state.clinic = [
      clinicPro({
        professionalId: "pr-ju",
        fullName: "Juliana Silva",
        disciplines: ["medico", "nutricionista"],
      }),
    ];
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: /adicionar profissional/i }));
    expect(screen.getByText("Juliana Silva")).toBeInTheDocument();
    expect(screen.getByText("Médica · Nutricionista")).toBeInTheDocument();
  });

  it("chama assign só com patient e professional", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: /adicionar profissional/i }));
    await user.click(screen.getByRole("button", { name: /carlos lima/i }));
    await user.click(screen.getByRole("button", { name: /^adicionar$/i }));
    expect(assignMutate).toHaveBeenCalledTimes(1);
    expect(assignMutate.mock.calls[0][0]).toEqual({
      patientId: "pat-1",
      professionalId: "pr-carlos",
    });
  });

  it("sucesso fecha o dialog e anuncia a equipe", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: /adicionar profissional/i }));
    await user.click(screen.getByRole("button", { name: /carlos lima/i }));
    await user.click(screen.getByRole("button", { name: /^adicionar$/i }));
    expect(screen.queryByRole("heading", { name: /adicionar profissional/i })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/adicionado à equipe/i);
  });

  it("erro NÃO fecha como sucesso e NÃO anuncia sucesso", async () => {
    assignMutate.mockImplementation((_vars: unknown, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.({ code: "42501" });
    });
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: /adicionar profissional/i }));
    await user.click(screen.getByRole("button", { name: /carlos lima/i }));
    await user.click(screen.getByRole("button", { name: /^adicionar$/i }));
    expect(screen.getByRole("heading", { name: /adicionar profissional/i })).toBeInTheDocument();
    expect(screen.queryByText(/adicionado à equipe/i)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("loading impede segunda submissão", async () => {
    state.assignPending = true;
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: /adicionar profissional/i }));
    await user.click(screen.getByRole("button", { name: /carlos lima/i }));
    expect(screen.getByRole("button", { name: /^adicionar$/i })).toBeDisabled();
    expect(assignMutate).not.toHaveBeenCalled();
  });
});

describe("Equipe da paciente — avatar", () => {
  it("avatar_path → foto; sem path → iniciais", () => {
    state.team = [
      teamMember({ fullName: "Neemias Costa", avatarPath: "pf-n/a.webp" }),
      teamMember({
        linkId: "l2",
        professionalId: "pr-v",
        fullName: "Vanda Costa",
        avatarPath: null,
      }),
    ];
    renderSection();
    const photos = screen.getAllByTestId("profile-photo");
    expect(photos[0]).toHaveAttribute("data-photo", "signed");
    expect(photos[1]).toHaveAttribute("data-photo", "fallback");
    expect(screen.getByText("VC")).toBeInTheDocument();
  });
});

describe("desativar / reativar — não-regressão", () => {
  it("admin ainda desativa o vínculo ativo", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: /desativar vínculo de ana prado/i }));
    await user.click(screen.getByRole("button", { name: /desativar vínculo$/i }));
    expect(deactivateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ professionalId: "pr-ana", patientId: "pat-1" }),
      expect.any(Object),
    );
  });

  it("admin ainda reativa o vínculo inativo", async () => {
    state.team = [teamMember({ status: "inactive" })];
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByRole("button", { name: /reativar vínculo de ana prado/i }));
    await user.click(screen.getByRole("button", { name: /reativar vínculo$/i }));
    expect(reactivateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ professionalId: "pr-ana", patientId: "pat-1" }),
      expect.any(Object),
    );
  });
});
