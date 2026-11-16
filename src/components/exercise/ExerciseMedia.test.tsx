import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExerciseMedia } from "./ExerciseMedia";

const item = { id: "1", name: "Supino sentado na máquina", mediaUrl: "https://x/a.webp", gifUrl: "https://x/a.gif" } as never;

describe("ExerciseMedia: nunca um quadro escuro vazio", () => {
  it("enquanto a imagem não chega mostra o ícone; ao carregar, o ícone sai", () => {
    render(<ExerciseMedia item={item} />);
    expect(screen.getByTestId("exercise-media-icon")).toBeInTheDocument();
    fireEvent.load(screen.getByAltText("Supino sentado na máquina"));
    expect(screen.queryByTestId("exercise-media-icon")).toBeNull();
  });
  it("webp falha → tenta o GIF; GIF falha → ícone de substituição (como no app), sem imagem quebrada", () => {
    render(<ExerciseMedia item={item} />);
    fireEvent.error(screen.getByAltText("Supino sentado na máquina"));
    expect(screen.getByAltText("Supino sentado na máquina").getAttribute("src")).toBe("https://x/a.gif");
    fireEvent.error(screen.getByAltText("Supino sentado na máquina"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByTestId("exercise-media-icon")).toBeInTheDocument();
  });
  it("miniatura com zoom aproxima a figura", () => {
    render(<ExerciseMedia item={item} zoom />);
    expect(screen.getByAltText("Supino sentado na máquina").className).toContain("scale-[1.45]");
  });
});
