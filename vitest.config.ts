import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * TESTES DO PAINEL — lógica pura E fiação de tela (WP-INFRA-JSDOM, DÍVIDA-TEST-1).
 *
 * ANTES: `environment: "node"` e `include: ["src/**\/*.test.ts"]` — só `.ts`, o que por
 * construção excluía qualquer teste de componente. As DECISÕES estavam cobertas por função pura,
 * mas a FIAÇÃO (qual botão aparece, o que o diálogo faz, para onde o ProtectedRoute desvia) não
 * tinha como ser testada: o arquivo nem seria coletado.
 *
 * A RECEITA É A MESMA QUE JÁ RODA NO vertexa-app-paciente — jsdom + testing-library + jest-dom,
 * `setupFiles` apontando para um setup compartilhado e `include` cobrindo .ts e .tsx. Não foi
 * inventada uma segunda configuração.
 *
 * UMA DIFERENÇA EM RELAÇÃO ÀQUELE REPO, e é adaptação, não desenho novo: o plugin de React é o
 * `@vitejs/plugin-react` que ESTE repo já usa no vite.config.ts (lá é o `-swc`). Usar o plugin do
 * próprio repo é o que mantém a transformação de TSX idêntica à do build.
 *
 * ⚠️ `globals: true` NÃO É COSMÉTICO, e eu descobri isso tentando viver sem ele: o auto-cleanup do
 * @testing-library/react só se registra quando os hooks globais (`afterEach`) existem. Sem globals,
 * cada `render()` acumula no mesmo document e o segundo teste do arquivo já falha com "Found
 * multiple elements". É por isso que a receita provada tem globals — e é por isso que ele fica.
 * Nada muda para os testes existentes: todos importam `describe/it/expect` de "vitest"
 * explicitamente, e continuam válidos (globals ADICIONA, não substitui). Por isso também não foi
 * preciso tocar no tsconfig.json, que é arquivo de build e está fora do escopo deste WP.
 */
export default defineConfig({
  plugins: [react()],
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
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
