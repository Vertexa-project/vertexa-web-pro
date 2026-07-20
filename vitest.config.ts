import { defineConfig } from "vitest/config";

// Testes unitários de lógica PURA (sem DOM) — introduzidos no WP-DISC B para a derivação de
// permissões por disciplina. Ambiente `node`; só arquivos *.test.ts sob src.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
