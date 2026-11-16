import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pdf = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 5,
      destroy: () => Promise.resolve(),
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
        render: () => { pdf.render(); return { promise: Promise.resolve() }; },
      }),
    }),
  }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));

import { PdfPagesPreview } from "./PdfPagesPreview";

describe("PdfPagesPreview — prévia do PDF sem iframe", () => {
  it("desenha as páginas como imagem (até 3), sem depender do leitor de PDF do navegador", async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as never;
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,AAA");
    render(<PdfPagesPreview bytes={new ArrayBuffer(8)} />);
    expect(await screen.findByAltText("Documento enviado, página 1")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(3)); // a 1ª página aparece e as outras chegam em seguida
    expect(pdf.render).toHaveBeenCalledTimes(3);
    expect(document.querySelector("iframe")).toBeNull();
  });
});
