/**
 * Registro das fontes da marca no @react-pdf/renderer para o PDF casar com o web:
 * corpo = Inter, display = Plus Jakarta Sans (mesma escolha do tailwind.config.ts).
 *
 * Formato: usamos os arquivos **.woff** do @fontsource (o Vite resolve o import para uma
 * URL de asset same-origin — sem CDN, sem CORS, funciona offline). @react-pdf suporta
 * TTF e WOFF; NÃO suporta WOFF2 (Brotli) no browser — por isso .woff, não .woff2.
 */
import { Font } from "@react-pdf/renderer";

import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff";
import inter500 from "@fontsource/inter/files/inter-latin-500-normal.woff";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff";
import inter700 from "@fontsource/inter/files/inter-latin-700-normal.woff";
import jakarta600 from "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-600-normal.woff";
import jakarta700 from "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff";
import jakarta800 from "@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-800-normal.woff";

let registered = false;

/** Idempotente — chamar antes de gerar qualquer relatório. */
export function registerReportFonts(): void {
  if (registered) return;
  registered = true;

  Font.register({
    family: "Inter",
    fonts: [
      { src: inter400, fontWeight: 400 },
      { src: inter500, fontWeight: 500 },
      { src: inter600, fontWeight: 600 },
      { src: inter700, fontWeight: 700 },
    ],
  });

  Font.register({
    family: "PlusJakarta",
    fonts: [
      { src: jakarta600, fontWeight: 600 },
      { src: jakarta700, fontWeight: 700 },
      { src: jakarta800, fontWeight: 800 },
    ],
  });

  // Sem hifenização automática (quebraria "palavras" como "Bioimpedância" com hífens feios).
  Font.registerHyphenationCallback((word) => [word]);
}
