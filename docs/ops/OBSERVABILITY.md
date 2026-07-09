# Observabilidade (Sentry) — Web Profissional

> Fundação de captura de erros do painel web (browser). Instrumentada em **OBS-01**
> (branch `feat/obs-sentry-web`). **Zero mudança de comportamento de produto**: o app roda
> IDÊNTICO com e sem observabilidade.

## O que é

`@sentry/react` capturando, quando há DSN configurado:

- **Erros de render** (via o `ErrorBoundary` global → `captureException`).
- **Rejections não tratadas** e `window.onerror` (integração default `globalHandlers` do SDK).
- **Erros de dados (Supabase/API)** — todo erro de query/mutation do react-query é reportado
  no `QueryCache`/`MutationCache` (`src/providers/query-client.ts`), sem tocar em `api/`/`hooks/`.

Metadados: `environment`, `release` (commit SHA) e `sendDefaultPii: false`.

## Arquitetura (3 arquivos)

| Arquivo | Papel |
|---|---|
| `src/lib/observability/scrub.ts` | **Puro, sem dependência de framework.** O scrubbing de PII/saúde. Núcleo testável. |
| `src/lib/observability/sentry.ts` | **Facade leve** (import estático). `initObservability()` / `captureException()`. NÃO importa o SDK. |
| `src/lib/observability/sentry-client.ts` | **Camada pesada** — a única que importa `@sentry/react`. Carregada por `import()` dinâmico só quando há DSN. |

**Boot leve / init tardio:** sem DSN, o chunk do SDK (~30 KB gzip) **nem é baixado**. Com DSN,
ele carrega de forma assíncrona, fora do caminho crítico do boot.

## Variáveis de ambiente

Todas OPCIONAIS (ver `.env.example`). **Sem `VITE_SENTRY_DSN` → observabilidade desligada (no-op).**

| Var | Efeito |
|---|---|
| `VITE_SENTRY_DSN` | DSN público do browser. Vazio = desligado. É o único "segredo" que pode ir ao bundle (DSN de browser é público por design). **Nunca** colocar chave de servidor. |
| `VITE_APP_ENV` | `environment` no Sentry (ex.: `production`, `staging`). Default = `MODE` do Vite. |
| `VITE_APP_RELEASE` | `release` (idealmente o commit SHA). Em CI/Vercel: `VITE_APP_RELEASE=$VERCEL_GIT_COMMIT_SHA`. Se vazio, o build injeta o SHA curto do git (ver `vite.config.ts`). |

## Como validar um evento de teste

1. Preencha `VITE_SENTRY_DSN` no `.env` com o DSN do projeto Sentry.
2. `npm run build && npm run preview` (ou `npm run dev`).
3. No console do browser, dispare um erro não tratado:
   ```js
   Promise.reject(new Error("teste de observabilidade OBS-01"));
   ```
4. O evento deve aparecer no Sentry em ~segundos, com `environment`/`release` corretos.
   Confirme na aba **Network** que o POST ao endpoint de ingest do Sentry **não contém PII**.

## Garantias de scrubbing (LGPD / dado de saúde)

Provado por evento sintético (16 agulhas de PII falsa — ver `scrub.ts`). `beforeSend`/
`beforeBreadcrumb` removem, de TODO evento:

- **Identidade:** `user` (id/email/ip/username) e `server_name` — removidos por completo.
- **URLs:** query string descartada (mata URL assinada de storage) + UUID de paciente na rota → `:id`.
- **Request:** `headers`/`cookies`/`data`/`query_string` removidos (Authorization/Cookie fora).
- **Strings:** e-mail, telefone, JWT, token longo e UUID redigidos onde aparecerem.
- **Texto livre** (`message`, `value` da exceção): além do acima, frases clínicas
  (`paciente …`, `diagnóstico: …`, `plano: …`, `exame …`) redigidas.
- **Chaves sensíveis** em `extra`/`tags`/contexts custom (nome, diagnóstico, plano, token…) → `[redacted]`.
- **Variáveis locais** dos frames de stack descartadas.
- `browser`/`os`/`trace` preservados (úteis, sem PII).

### Residual conhecido

Scrubbing por padrão **não detecta** um nome humano em prosa livre **sem** palavra-chave
clínica (ex.: `throw new Error("Falha para João")`). Mitigações:
1. **Convenção:** nunca interpolar dado de paciente em mensagens de erro lançadas (a camada
   `api/` não faz isso — erros vêm do Supabase/genéricos).
2. **Defesa em profundidade:** habilitar o *server-side data scrubbing* do Sentry.

## Decisões / dívidas

- **Tracing de performance DESLIGADO** (`tracesSampleRate: 0`, sem `browserTracingIntegration`):
  spans de fetch carregariam a URL assinada do Supabase. Reabrir exige também um
  `beforeSendTransaction` com scrubbing.
- **Source maps de produção** ligados (`vite.config.ts` `build.sourcemap: true`) para
  simbolicar stack traces. ⚠️ Servir os `.map` publicamente expõe o código-fonte. Endurecer
  antes de publicar: `sourcemap: 'hidden'` + upload dos maps ao Sentry (não servir os `.map`).
- **Segurança pré-produção:** ver `docs/PENDENCIAS.md` (RLS #11–#14). A observabilidade não
  altera o modelo de acesso a dados.
