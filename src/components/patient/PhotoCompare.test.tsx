import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ProgressPhotoWithUrl } from "@/lib/api/assessments";
import { PhotoCompare } from "./PhotoCompare";

const photo = (id: string, taken_at: string, pose: ProgressPhotoWithUrl["pose"]): ProgressPhotoWithUrl => ({
  id,
  patient_id: "p1",
  photo_url: "",
  storage_path: `p1/${id}.jpg`,
  captured_in_app: true,
  taken_at,
  pose,
  display_url: `https://signed.example/${id}`,
});

describe("PhotoCompare — só compara a MESMA posição", () => {
  it("sem duas fotos na mesma posição: explica o que falta e não mostra imagens", () => {
    render(<PhotoCompare photos={[photo("a", "2026-01-10T12:00:00Z", "front"), photo("b", "2026-02-10T12:00:00Z", "back")]} />);
    expect(screen.getByText(/pelo menos duas fotos na mesma posição/i)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("padrão: a mais antiga × a mais recente DA posição, nunca de outra posição", () => {
    render(
      <PhotoCompare
        photos={[
          photo("f-old", "2026-01-10T12:00:00Z", "front"),
          photo("back-mid", "2026-02-01T12:00:00Z", "back"),
          photo("f-new", "2026-03-10T12:00:00Z", "front"),
          photo("back-new", "2026-04-01T12:00:00Z", "back"),
        ]}
      />,
    );
    const imgs = screen.getAllByRole("img") as HTMLImageElement[];
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual(["https://signed.example/f-old", "https://signed.example/f-new"]);
  });

  it("foto sem URL (falha ao assinar) mostra placeholder acessível, não imagem quebrada", () => {
    const broken = { ...photo("f-new", "2026-03-10T12:00:00Z", "front"), display_url: null };
    render(<PhotoCompare photos={[photo("f-old", "2026-01-10T12:00:00Z", "front"), broken]} />);
    expect(screen.getByLabelText(/Depois: foto indisponível/i)).toBeTruthy();
  });
});
