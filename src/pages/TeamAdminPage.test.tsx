import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { ProfessionalWithDisciplines } from "@/lib/api/disciplines";
import type { ProfessionalStatusEvent } from "@/lib/api/professionalStatus";

/**
 * A LINHA DA EQUIPE E O DIÁLOGO (WP-FRONT-2bii-A item 1) — cobertura de FIAÇÃO.
 *
 * A DECISÃO de qual ação cabe em cada linha já é testada por função pura
 * (`resolveMemberAction`, com a ordem de recusa do servidor). Este arquivo cobre o que ela não
 * alcança: que o badge certo é RENDERIZADO, que a trilha vira texto legível, que o botão certo
 * (ou a razão, no lugar dele) chega à tela, e que o diálogo faz o que promete — abre, aceita o
 * motivo, chama a mutação com o argumento certo e trava enquanto ela roda.
 */

const OWNER_PROFILE = "pf-dono";
const ME_PROF = "pr-eu";

const state = vi.hoisted(() => ({
  isClinicAdmin: true,
  adminLoading: false,
  team: [] as unknown[],
  events: [] as unknown[],
  eventsLoading: false,
  deactivatePending: false,
}));

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

vi.mock("@/hooks/useCurrentProfessional", () => ({
  useCurrentProfessional: () => ({ data: { id: ME_PROF, clinicId: "c1" }, isLoading: false }),
}));
vi.mock("@/hooks/useIsClinicAdmin", () => ({
  useIsClinicAdmin: () => ({
    isClinicAdmin: state.isClinicAdmin,
    isLoading: state.adminLoading,
    isError: false,
  }),
}));
vi.mock("@/hooks/useClinicJoin", () => ({
  usePendingJoinRequests: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useApproveJoinRequest: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectJoinRequest: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useDisciplines", () => ({
  useClinicProfessionalDisciplines: () => ({
    data: state.team,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useDisciplinesList: () => ({ data: [{ code: "nutricionista", label: "Nutricionista" }] }),
}));
vi.mock("@/hooks/useClinic", () => ({
  useClinic: () => ({ data: { id: "c1", name: "Clínica Alfa", owner_profile_id: OWNER_PROFILE } }),
}));
vi.mock("@/hooks/useProfessionalStatus", () => ({
  useProfessionalStatusEvents: () => ({ data: state.events, isLoading: state.eventsLoading }),
  useDeactivateProfessional: () => ({ mutate: deactivateMutate, isPending: state.deactivatePending }),
  useReactivateProfessional: () => ({ mutate: reactivateMutate, isPending: false }),
}));
vi.mock("@/lib/observability/sentry", () => ({ captureException: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));

const { TeamAdminPage } = await import("./TeamAdminPage");

function member(over: Partial<ProfessionalWithDisciplines> = {}): ProfessionalWithDisciplines {
  return {
    professionalId: "pr-1",
    profileId: "pf-1",
    fullName: "Bruno Salles",
    type: "nutritionist",
    status: "active",
    disciplines: ["nutricionista"],
    ...over,
  };
}

function event(over: Partial<ProfessionalStatusEvent> = {}): ProfessionalStatusEvent {
  return {
    professionalId: "pr-1",
    fromStatus: "active",
    toStatus: "inactive",
    reason: "saiu da clínica",
    changedAt: "2026-07-28T14:30:00Z",
    changedByName: "Ana Prado",
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TeamAdminPage />
    </MemoryRouter>,
  );
}

/**
 * A linha (Card) daquela pessoa — as asserções são escopadas nela, nunca na página inteira.
 *
 * ⚠️ Recebe o nome COMO A TELA O EXIBE, não como ele está no banco: a lista passa por `shortName`,
 * então "Bruno Salles" aparece como "Bruno". Procurar aqui pelo nome completo não acha nada.
 */
function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("div.flex.flex-col") as HTMLElement;
}

beforeEach(() => {
  state.isClinicAdmin = true;
  state.adminLoading = false;
  state.team = [member()];
  state.events = [];
  state.eventsLoading = false;
  state.deactivatePending = false;
  deactivateMutate.mockClear();
  reactivateMutate.mockClear();
});

describe("linha da equipe — o badge de status", () => {
  it("ativo mostra 'Ativo'", () => {
    renderPage();
    expect(within(rowOf("Bruno")).getByText("Ativo")).toBeInTheDocument();
  });

  it("inativo mostra 'Inativo'", () => {
    state.team = [member({ status: "inactive" })];
    renderPage();
    expect(within(rowOf("Bruno")).getByText("Inativo")).toBeInTheDocument();
  });

  // status null = ATIVO, espelhando coalesce(status,'active') do banco.
  it("status nulo é apresentado como Ativo", () => {
    state.team = [member({ status: null })];
    renderPage();
    expect(within(rowOf("Bruno")).getByText("Ativo")).toBeInTheDocument();
  });

  it("o DONO ganha o selo de Dono", () => {
    state.team = [member({ profileId: OWNER_PROFILE, fullName: "Zulmira Dona" })];
    renderPage();
    expect(within(rowOf("Zulmira")).getByText("Dono")).toBeInTheDocument();
  });
});

describe("linha da equipe — a trilha (quem, quando, por quê)", () => {
  it("em quem está inativo, mostra quem desativou, a data e o motivo", () => {
    state.team = [member({ status: "inactive" })];
    state.events = [event()];
    renderPage();

    const row = rowOf("Bruno");
    expect(within(row).getByText(/Desativado por Ana Prado/)).toBeInTheDocument();
    expect(within(row).getByText(/saiu da clínica/)).toBeInTheDocument();
  });

  it("sem nome do autor (RLS não deixou ver), cai no genérico em vez de sumir", () => {
    state.team = [member({ status: "inactive" })];
    state.events = [event({ changedByName: null })];
    renderPage();

    expect(
      within(rowOf("Bruno")).getByText(/Desativado por um administrador da clínica/),
    ).toBeInTheDocument();
  });

  it("inativo SEM evento na trilha: diz isso, não finge que sabe", () => {
    state.team = [member({ status: "inactive" })];
    state.events = [];
    renderPage();

    expect(
      within(rowOf("Bruno")).getByText(/Desativado — sem registro de quem ou quando/),
    ).toBeInTheDocument();
  });

  it("em quem está ATIVO, nenhuma linha de trilha aparece", () => {
    state.team = [member({ status: "active" })];
    state.events = [event({ toStatus: "active" })];
    renderPage();

    expect(within(rowOf("Bruno")).queryByText(/Desativado por/)).not.toBeInTheDocument();
  });
});

describe("linha da equipe — QUAL botão aparece", () => {
  it("caso normal (admin, colega ativo): botão Desativar", () => {
    renderPage();
    const row = rowOf("Bruno");
    expect(within(row).getByRole("button", { name: /Desativar acesso de/ })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Reativar acesso de/ })).not.toBeInTheDocument();
  });

  it("colega INATIVO: botão Reativar", () => {
    state.team = [member({ status: "inactive" })];
    renderPage();
    const row = rowOf("Bruno");
    expect(within(row).getByRole("button", { name: /Reativar acesso de/ })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Desativar acesso de/ })).not.toBeInTheDocument();
  });

  it("o DONO não tem botão — e no lugar aparece a RAZÃO (transferir a posse)", () => {
    state.team = [member({ profileId: OWNER_PROFILE, fullName: "Zulmira Dona" })];
    renderPage();

    const row = rowOf("Zulmira");
    expect(within(row).queryByRole("button", { name: /Desativar acesso de/ })).not.toBeInTheDocument();
    expect(within(row).getByText(/transfira a posse antes/i)).toBeInTheDocument();
  });

  it("EU MESMO não tenho botão — e a razão manda pedir a outro administrador", () => {
    state.team = [member({ professionalId: ME_PROF, fullName: "Eu Mesmo" })];
    renderPage();

    const row = rowOf("Eu");
    expect(within(row).queryByRole("button", { name: /Desativar acesso de/ })).not.toBeInTheDocument();
    expect(within(row).getByText(/não pode desativar o próprio cadastro/i)).toBeInTheDocument();
    expect(within(row).getByText("(você)")).toBeInTheDocument();
  });

  // Página inteira é admin-only (decisão registrada do dono). Se um NÃO-admin renderizar a
  // seção, ela é somente leitura — a regra vive no componente, não só no gate da página.
  it("NÃO-ADMIN: a página inteira nega, e nenhum botão de estado existe", () => {
    state.isClinicAdmin = false;
    renderPage();

    expect(screen.getByText(/Apenas o administrador da clínica gerencia a equipe/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Desativar acesso de/ })).not.toBeInTheDocument();
  });

  it("enquanto o sinal de admin carrega, nada é oferecido (fail-closed)", () => {
    state.adminLoading = true;
    renderPage();

    expect(screen.getByText(/Verificando suas permissões/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Desativar acesso de/ })).not.toBeInTheDocument();
  });
});

describe("o diálogo de confirmação", () => {
  it("abre com o efeito REAL escrito, e não dispara nada sozinho", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Desativar acesso de/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Desativar o acesso de Bruno\?/)).toBeInTheDocument();
    expect(within(dialog).getByText(/perde o acesso a TODOS os pacientes/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/sai das conversas/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/viram histórico/i)).toBeInTheDocument();
    expect(deactivateMutate).not.toHaveBeenCalled();
  });

  it("na REATIVAÇÃO, o texto diz a assimetria (não devolve os pacientes)", async () => {
    const user = userEvent.setup();
    state.team = [member({ status: "inactive" })];
    renderPage();

    await user.click(screen.getByRole("button", { name: /Reativar acesso de/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/NÃO devolve os pacientes/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/reconquistado um a um/i)).toBeInTheDocument();
  });

  it("digitar o motivo e confirmar chama a mutação com o motivo", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Desativar acesso de/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByLabelText(/Motivo \(opcional\)/i), "encerrou o contrato");
    await user.click(within(dialog).getByRole("button", { name: "Desativar acesso" }));

    expect(deactivateMutate).toHaveBeenCalledTimes(1);
    expect(deactivateMutate.mock.calls[0][0]).toEqual({
      professionalId: "pr-1",
      reason: "encerrou o contrato",
    });
  });

  // Motivo é OPCIONAL: vazio vira null e a trilha não carimba razão nenhuma.
  it("confirmar sem motivo manda null (não string vazia)", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Desativar acesso de/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Desativar acesso" }));

    expect(deactivateMutate.mock.calls[0][0]).toEqual({ professionalId: "pr-1", reason: null });
  });

  it("cancelar fecha sem chamar nada", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Desativar acesso de/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    expect(deactivateMutate).not.toHaveBeenCalled();
  });

  // Enquanto a mutação roda, os dois botões travam — clicar duas vezes desativaria duas vezes.
  it("durante a mutação, Confirmar e Cancelar ficam DESABILITADOS", async () => {
    const user = userEvent.setup();
    state.deactivatePending = true;
    renderPage();

    await user.click(screen.getByRole("button", { name: /Desativar acesso de/ }));
    const dialog = await screen.findByRole("alertdialog");

    expect(within(dialog).getByRole("button", { name: /Desativar acesso/ })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeDisabled();
  });

  it("reativar chama a OUTRA mutação, não a de desativar", async () => {
    const user = userEvent.setup();
    state.team = [member({ status: "inactive" })];
    renderPage();

    await user.click(screen.getByRole("button", { name: /Reativar acesso de/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Reativar acesso" }));

    expect(reactivateMutate).toHaveBeenCalledTimes(1);
    expect(deactivateMutate).not.toHaveBeenCalled();
  });
});
