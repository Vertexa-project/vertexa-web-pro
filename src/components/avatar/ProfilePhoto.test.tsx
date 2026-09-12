import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/avatar", () => ({
  getAvatarSignedUrl: vi.fn(async (path: string) => `https://signed.example/${path}`),
  getAvatarSignedUrls: vi.fn(),
}));

import { ProfilePhoto } from "./ProfilePhoto";

function renderPhoto(props: ComponentProps<typeof ProfilePhoto>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProfilePhoto {...props} />
    </QueryClientProvider>,
  );
}

describe("ProfilePhoto", () => {
  it("sem path mostra iniciais, não foto", () => {
    renderPhoto({ name: "Luana dos Santos Costa" });
    expect(screen.getByText("LC")).toBeInTheDocument();
    expect(screen.getByTestId("profile-photo")).toHaveAttribute("data-photo", "fallback");
  });

  it("com signedUrl resolvida marca foto (sem broken image)", () => {
    renderPhoto({
      name: "Luana dos Santos Costa",
      avatarPath: "pf/abc.webp",
      signedUrl: "https://signed.example/pf/abc.webp",
    });
    expect(screen.getByTestId("profile-photo")).toHaveAttribute("data-photo", "signed");
  });
});
