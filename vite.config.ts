import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
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
    rollupOptions: {
      output: {
        // Separa vendors grandes em chunks próprios (melhor cache; sai do bundle inicial monolítico).
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
          query: ["@tanstack/react-query"],
          charts: ["recharts"],
          dates: ["date-fns"],
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
});
