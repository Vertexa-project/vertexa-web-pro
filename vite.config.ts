import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** SHA curto do git como fallback de release quando o CI não injeta VITE_APP_RELEASE. */
function gitShortSha(): string | undefined {
  try {
    // execFileSync (sem shell) com args fixos — sem interpolação, sem risco de injeção.
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

export default defineConfig(({ mode }) => {
  // Release do Sentry: prioriza o que o CI/Vercel injeta; senão, o SHA curto do git.
  // Não sobrescreve um VITE_APP_RELEASE explícito (via .env ou process.env).
  const env = loadEnv(mode, projectRoot, "");
  if (!env.VITE_APP_RELEASE) {
    const fallback = process.env.VERCEL_GIT_COMMIT_SHA || gitShortSha();
    if (fallback) process.env.VITE_APP_RELEASE = fallback;
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(projectRoot, "src"),
      },
    },
    server: {
      port: 5173,
    },
    build: {
      // Source maps de produção → o Sentry consegue simbolicar os stack traces.
      // Nota: expõe o código-fonte publicamente se os .map forem servidos. Endurecer com
      // sourcemap:'hidden' + upload dos maps ao Sentry antes de publicar (ver OBSERVABILITY.md).
      sourcemap: true,
      rollupOptions: {
        output: {
          // Separa vendors grandes em chunks próprios (melhor cache; sai do bundle inicial monolítico).
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            supabase: ["@supabase/supabase-js"],
            query: ["@tanstack/react-query"],
            charts: ["recharts"],
            dates: ["date-fns"],
            // Observabilidade (Sentry) em chunk próprio — fora do caminho crítico do boot.
            sentry: ["@sentry/react"],
            // FullCalendar (Sessão 12) — pesado (~300 KB gzip). Chunk próprio + lazy() no AgendaCard
            // mantêm o Dashboard fora do caminho crítico. v6 auto-injeta CSS (sem import de .css).
            fullcalendar: [
              "@fullcalendar/core",
              "@fullcalendar/react",
              "@fullcalendar/daygrid",
              "@fullcalendar/timegrid",
              "@fullcalendar/list",
              "@fullcalendar/interaction",
            ],
          },
        },
      },
    },
  };
});
