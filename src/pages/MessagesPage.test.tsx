import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import type { ChannelProfessional, ChatMessageView, PatientListItem } from "@/types/db";

/**
 * AS DUAS PERGUNTAS DO CHAT (WP-FRONT-2bii-A item 2) — cobertura de FIAÇÃO.
 *
 * A REGRA já é testada por função pura (`mentionableProfessionals`, `namesByProfileId`): dada uma
 * lista, quem entra e quem sai. O que função pura NÃO alcança — e é justamente onde o defeito
 * moraria — é QUAL lista chega em cada lugar da tela. Enquanto as duas dividiam uma chamada só,
 * uma resposta servia às duas perguntas; separá-las só vale se a fiação estiver certa, e fiação
 * se prova montando.
 *
 * O caso que este arquivo trava, no MESMO render:
 *   · o seletor de @ NÃO oferece quem foi desativado (roster, includeAuthors = false);
 *   · a bolha do histórico CONTINUA com o nome dele (autores, includeAuthors = true).
 * Se as duas voltarem a beber da mesma fonte, um dos dois lados quebra aqui.
 */

const CHANNEL = "ch-1";
const ME = "pf-eu";

const ATIVA: ChannelProfessional = {
  profileId: "pf-helena",
  name: "Dra. Helena Braga",
  type: "nutritionist",
  specialty: null,
  disciplines: ["nutricionista"],
};
const DESATIVADO: ChannelProfessional = {
  profileId: "pf-rui",
  name: "Dr. Rui Falcão",
  type: "personal_trainer",
  specialty: null,
  disciplines: ["educador_fisico"],
};
const EU: ChannelProfessional = {
  profileId: ME,
  name: "Bruno Salles",
  type: "nutritionist",
  specialty: null,
  disciplines: [],
};

const state = vi.hoisted(() => ({
  /** Toda chamada a useChannelProfessionals, na ordem — é o registro das DUAS perguntas. */
  calls: [] as { channelId: unknown; includeAuthors: boolean }[],
  roster: { data: [] as unknown[], isPending: false, isError: false },
  authors: { data: [] as unknown[], isPending: false, isError: false },
  messages: [] as unknown[],
  patients: [] as PatientListItem[],
}));

vi.mock("@/hooks/useChat", () => ({
  useChannelProfessionals: (channelId: unknown, includeAuthors = false) => {
    state.calls.push({ channelId, includeAuthors });
    const q = includeAuthors ? state.authors : state.roster;
    return { data: q.data, isPending: q.isPending, isError: q.isError, refetch: vi.fn() };
  },
  useChatThread: () => ({
    data: { channelId: CHANNEL, actingProfileId: ME, messages: state.messages },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSendChatMessage: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useUnreadMentions: () => ({ data: { byPatient: {} } }),
  useMarkMentionsRead: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/useDisciplines", () => ({
  useDisciplinesList: () => ({
    data: [
      { code: "nutricionista", label: "Nutricionista" },
      { code: "educador_fisico", label: "Educador físico" },
    ],
  }),
}));
vi.mock("@/hooks/usePatients", () => ({
  useListPatients: () => ({ data: state.patients, isLoading: false, isError: false, refetch: vi.fn() }),
}));
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

const { MessagesPage } = await import("./MessagesPage");

function patient(): PatientListItem {
  return {
    id: "pac-1",
    goal: null,
    current_weight: null,
    start_date: null,
    birth_date: null,
    profile: { full_name: "Marina Alves", email: null, avatar_url: null },
    snapshot: null,
    professionals: [],
    lastActivityAt: null,
    lastWeightAt: null,
    lastPhotoAt: null,
    lastWorkoutAt: null,
  };
}

function message(over: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id: "m-1",
    channel_id: CHANNEL,
    sender_profile_id: DESATIVADO.profileId,
    sender_role: "professional",
    // ⚠️ NULO de propósito: é o que produção devolve para mensagem de COLEGA (o embed `profiles`
    // do remetente não passa por `can_see_profile`). É por isso que o nome tem de vir da RPC.
    sender_name: null,
    body: "Ajustei o plano de treino desta semana.",
    created_at: "2026-07-20T10:00:00Z",
    attachment_path: null,
    attachment_name: null,
    attachment_mime: null,
    attachment_size: null,
    reply_to_message_id: null,
    mentioned_profile_ids: [],
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <MessagesPage />
    </MemoryRouter>,
  );
}

async function openMentionPicker() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Marcar um profissional" }));
  return { user, picker: screen.getByRole("dialog", { name: "Marcar um profissional" }) };
}

beforeEach(() => {
  state.calls = [];
  // O cenário do WP: Rui foi DESATIVADO — saiu do roster, mas assinou o histórico.
  state.roster = { data: [EU, ATIVA], isPending: false, isError: false };
  state.authors = { data: [EU, ATIVA, DESATIVADO], isPending: false, isError: false };
  state.messages = [message()];
  state.patients = [patient()];
});

describe("MessagesPage — as duas chamadas", () => {
  it("pergunta DUAS vezes pelo mesmo canal, com o parâmetro diferente", () => {
    renderPage();

    const doCanal = state.calls.filter((c) => c.channelId === CHANNEL);
    expect(doCanal.some((c) => c.includeAuthors === false)).toBe(true);
    expect(doCanal.some((c) => c.includeAuthors === true)).toBe(true);
  });
});

describe("MessagesPage — o seletor de @ e a bolha, no MESMO render", () => {
  it("o seletor NÃO oferece quem foi desativado", async () => {
    renderPage();
    const { picker } = await openMentionPicker();

    expect(within(picker).queryByText("Dr. Rui Falcão")).not.toBeInTheDocument();
    expect(within(picker).getByText("Dra. Helena Braga")).toBeInTheDocument();
  });

  it("…e, ao mesmo tempo, a bolha do histórico MANTÉM o nome dele", async () => {
    renderPage();
    const { picker } = await openMentionPicker();

    // A prova é a coexistência: ausente da lista de marcação, presente na autoria.
    expect(within(picker).queryByText("Dr. Rui Falcão")).not.toBeInTheDocument();
    expect(screen.getByText("Dr. Rui Falcão")).toBeInTheDocument();
  });

  // Se a bolha bebesse do roster (a lista curta), o nome não estaria lá e cairia no genérico.
  // Este teste é o que detecta a regressão de voltar a usar UMA lista só.
  it("o nome do desativado não degrada para o genérico 'Profissional'", () => {
    renderPage();

    expect(screen.getByText("Dr. Rui Falcão")).toBeInTheDocument();
    expect(screen.queryByText("Profissional")).not.toBeInTheDocument();
  });

  it("o próprio profissional atuante não se oferece para marcação", async () => {
    renderPage();
    const { picker } = await openMentionPicker();

    expect(within(picker).queryByText("Bruno Salles")).not.toBeInTheDocument();
  });

  // authorOf é UM lugar só: bolha e citação nunca podem discordar sobre a mesma pessoa.
  it("a citação usa a MESMA fonte de nome que a bolha", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Responder à mensagem de Dr. Rui Falcão" }));

    expect(screen.getByText(/Respondendo a Dr\. Rui Falcão/)).toBeInTheDocument();
  });

  it("mensagem da paciente é atribuída a ela, sem passar pela lista de profissionais", () => {
    state.messages = [
      message({ id: "m-2", sender_role: "patient", sender_profile_id: "pf-marina" }),
    ];
    renderPage();

    // O nome dela aparece no cabeçalho da conversa E como autora da bolha.
    expect(screen.getAllByText("Marina Alves").length).toBeGreaterThan(1);
  });
});

describe("MessagesPage — avatar da conversa", () => {
  it("avatar_path → foto; sem path → iniciais", () => {
    state.patients = [
      {
        ...patient(),
        id: "pac-foto",
        profile: { full_name: "Luana dos Santos Costa", email: null, avatar_url: null, avatar_path: "pf-lu/a.webp" },
      },
    ];
    renderPage();
    expect(screen.getAllByTestId("profile-photo")[0]).toHaveAttribute("data-photo", "signed");
  });

  it("sem avatar_path cai em iniciais", () => {
    renderPage();
    expect(screen.getAllByTestId("profile-photo")[0]).toHaveAttribute("data-photo", "fallback");
    expect(screen.getAllByText("MA").length).toBeGreaterThan(0);
  });
});

describe("MessagesPage — cada lista responde pelo seu próprio estado", () => {
  // O seletor é fiado no ROSTER. Uma falha na lista de AUTORES não pode apagá-lo — são perguntas
  // independentes, e é isso que separar as duas chamadas comprou.
  it("falha na lista de autores não derruba o seletor", async () => {
    state.authors = { data: [], isPending: false, isError: true };
    renderPage();
    const { picker } = await openMentionPicker();

    expect(within(picker).getByText("Dra. Helena Braga")).toBeInTheDocument();
    expect(within(picker).queryByText(/Não foi possível carregar a equipe/)).not.toBeInTheDocument();
  });

  it("falha no roster vira erro VISÍVEL dentro do seletor, com nova tentativa", async () => {
    state.roster = { data: [], isPending: false, isError: true };
    renderPage();
    const { picker } = await openMentionPicker();

    expect(within(picker).getByText(/Não foi possível carregar a equipe/)).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });
});
