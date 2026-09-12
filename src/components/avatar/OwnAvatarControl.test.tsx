import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const removeMyAvatar = vi.hoisted(() => vi.fn());
const replaceMyAvatar = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/avatar", () => ({
  getAvatarSignedUrl: vi.fn(async () => "https://signed.example/avatar.webp"),
  getProfileAvatarFields: vi.fn(),
  removeMyAvatar,
  replaceMyAvatar,
}));

import { OwnAvatarControl } from "./OwnAvatarControl";

const PROFILE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";

function renderControl(path: string | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OwnAvatarControl profileId={PROFILE} name="Neemias Santos" avatarPath={path} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  removeMyAvatar.mockReset();
  replaceMyAvatar.mockReset();
  removeMyAvatar.mockResolvedValue(undefined);
});

describe("OwnAvatarControl", () => {
  it("mostra iniciais quando não há foto", () => {
    renderControl(null);
    expect(screen.getByText("NS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alterar foto de perfil" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trocar foto" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remover foto" })).not.toBeInTheDocument();
  });

  it("recusa GIF com mensagem amigável", async () => {
    renderControl(null);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38])], "x.gif", { type: "image/gif" });
    fireEvent.change(input, { target: { files: [gif] } });
    expect(await screen.findByText(/Formato não suportado/)).toBeInTheDocument();
    expect(replaceMyAvatar).not.toHaveBeenCalled();
  });

  it("recusa arquivo acima de 8 MB", async () => {
    renderControl(null);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const big = new File([new Uint8Array([0xff, 0xd8, 0xff])], "a.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 8 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText(/Arquivo muito grande/)).toBeInTheDocument();
  });

  it("remover chama só a RPC do próprio usuário", async () => {
    const user = userEvent.setup();
    renderControl(`${PROFILE}/${"ab".repeat(16)}.webp`);
    await user.click(screen.getByRole("button", { name: "Remover foto" }));
    expect(removeMyAvatar).toHaveBeenCalledTimes(1);
  });
});
