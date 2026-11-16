// Carregador do pdf.js (separado do componente para o recarregamento rápido do Vite).
let loader: Promise<typeof import("pdfjs-dist")> | null = null;
/** Carrega o pdf.js (e aquece o worker) uma vez só. Chamado ao tocar em "Importar", para a prévia não esperar o download
 *  depois da leitura: os dois correm juntos. */
export function preloadPdfRenderer(): Promise<typeof import("pdfjs-dist")> {
  loader ??= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    void fetch(worker.default).catch(() => undefined); // baixa o worker já (fica no cache do navegador)
    return pdfjs;
  });
  loader.catch(() => { loader = null; });
  return loader;
}

