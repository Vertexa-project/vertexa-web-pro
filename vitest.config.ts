import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Testes unitários de lógica PURA (sem DOM) — introduzidos no WP-DISC B para a derivação de
// permissões por disciplina. Ambiente `node`; só arquivos *.test.ts sob src.
export default defineConfig({
  // MESMO destino que `vite.config.ts` e que o `paths` do tsconfig ("@/*" -> "./src/*").
  // Sem isto, um import de RUNTIME por alias falha SÓ no runner ("Failed to load url @/…"),
  // enquanto typecheck e build passam — os testes antigos escapavam porque só importavam TIPO por
  // alias, e tipo some na compilação. Provado por USO, não por declaração: `chatTeam.ts` importa
  // "@/lib/domain/format" por alias e a suíte inteira passa.
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
