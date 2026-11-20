import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useOnboardingTutorialControls } from "./tutorialContext";

const state = vi.hoisted(() => ({
  data: null as null | { title: string; videoUrl: string; pending: boolean },
  mutate: vi.fn(),
}));

vi.mock("@/hooks/useOnboardingTutorial", () => ({
  useMyOnboardingTutorial: () => ({ data: state.data }),
  useMarkOnboardingTutorialSeen: () => ({
    mutate: state.mutate,
    isPending: false,
  }),
}));

const { OnboardingTutorialProvider } = await import("./OnboardingTutorial");

function MenuButton() {
  const t = useOnboardingTutorialControls();
  return t.available ? <button onClick={t.open}>Tutorial do app</button> : null;
}

function renderShell() {
  return render(
    <OnboardingTutorialProvider audience="clinic">
      <MenuButton />
    </OnboardingTutorialProvider>,
  );
}

beforeEach(() => {
  state.data = null;
  state.mutate.mockReset();
});

describe("OnboardingTutorialProvider", () => {
  it("sem vídeo publicado não abre nada nem mostra o item do menu", () => {
    renderShell();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Tutorial do app")).toBeNull();
  });

  it("no primeiro acesso abre sozinho e marca como visto ao fechar", async () => {
    state.data = {
      title: "Comece por aqui",
      videoUrl: "https://x/v.mp4",
      pending: true,
    };
    const user = userEvent.setup();
    renderShell();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Comece por aqui")).toBeInTheDocument();
    expect(screen.getByLabelText("Vídeo do tutorial")).toHaveAttribute(
      "src",
      "https://x/v.mp4",
    );
    await user.click(screen.getByRole("button", { name: "Começar a usar" }));
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("já visto: não abre sozinho, mas o menu reabre sem marcar de novo", async () => {
    state.data = { title: "", videoUrl: "https://x/v.mp4", pending: false };
    const user = userEvent.setup();
    renderShell();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByText("Tutorial do app"));
    expect(await screen.findByText("Bem-vindo à Vertexa")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Começar a usar" }));
    expect(state.mutate).not.toHaveBeenCalled();
  });
});
