// Prévia do PDF enviado, desenhada como imagem das páginas a partir do arquivo local (sem iframe).
// O iframe de PDF fica em branco no Chrome do Android e mostra só a 1ª página no iPhone; desenhar as páginas funciona em todos.
// pdf.js é carregado só quando a Conferência abre um PDF (não pesa no carregamento do app).
import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";

const MAX_PAGES = 3;
const RENDER_WIDTH = 900; // px do desenho; a imagem se ajusta à largura do cartão

async function renderPages(bytes: ArrayBuffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  const out: string[] = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      await page.render({ canvasContext: ctx, viewport }).promise;
      out.push(canvas.toDataURL("image/png"));
    }
  } finally {
    void doc.destroy();
  }
  return out;
}

export function PdfPagesPreview({ bytes, totalHint }: { bytes: ArrayBuffer; totalHint?: string }) {
  const [pages, setPages] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setPages(null);
    setFailed(false);
    renderPages(bytes)
      .then((p) => { if (alive) (p.length ? setPages(p) : setFailed(true)); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [bytes]);

  if (failed) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
        <FileText className="h-6 w-6" aria-hidden />
        Não consegui mostrar o documento aqui.
      </div>
    );
  }
  if (!pages) {
    return (
      <div role="status" className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Preparando a prévia do documento…
      </div>
    );
  }
  return (
    <div className="max-h-72 space-y-2 overflow-y-auto bg-white lg:max-h-[480px]" data-testid="pdf-preview">
      {pages.map((src, i) => (
        <img key={i} src={src} alt={`Documento enviado, página ${i + 1}`} className="w-full" />
      ))}
      {totalHint ? <p className="px-2 pb-2 text-xs text-muted-foreground">{totalHint}</p> : null}
    </div>
  );
}
