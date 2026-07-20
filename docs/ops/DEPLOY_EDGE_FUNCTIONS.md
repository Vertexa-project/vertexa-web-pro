# Deploy — Edge Functions do Google Calendar

Runbook de publicação das Edge Functions `google-calendar-*` no projeto Supabase
`cdhjfyyuhmwrcuxqavib`. Complementa `docs/ops/SETUP_GOOGLE_CALENDAR.md` (setup do Google + secrets).

> ⚠️ **`verify_jwt` — guardrail que quebra o fluxo em silêncio se errado.**
> `google-calendar-callback` é o **redirect do Google** (OAuth), chamado pelo **navegador, SEM JWT
> de usuário** → precisa ser **público (`verify_jwt = false`)**. Se subir com `verify_jwt = true`, o
> gateway passa a exigir Authorization JWT, o Google recebe **401** e a conexão do calendário
> **falha silenciosamente** (o usuário só vê "falha"). As demais (`auth`/`sync`/`disconnect`) são
> chamadas pelo SPA **autenticado** (`supabase.functions.invoke`) → **`verify_jwt = true`**.
>
> Isso está travado em **`supabase/config.toml`** (`[functions.*].verify_jwt`), que a CLI lê no
> `functions deploy`. **Não** deploye sem esse arquivo (a CLI aplicaria o default `true` no callback).

## Estado atual publicado (no ar)

| Função | verify_jwt | versão |
|---|---|---|
| google-calendar-callback | **false** | **v2** |
| google-calendar-sync | true | **v2** |
| google-calendar-auth | true | v1 |
| google-calendar-disconnect | true | v1 |

**Registro (WP-A2):** o deploy atual de `callback` (v2) e `sync` (v2) — que passaram a usar as RPCs
cifradas `set_calendar_tokens` / `get_calendar_refresh_token` / `set_calendar_access_token` — foi feito
via **MCP Supabase (`deploy_edge_function`)** com `verify_jwt` **explícito** por função (callback=false,
sync=true), porque a CLI local estava autenticada em outra conta (sem acesso à org do Vertexa). `auth` e
`disconnect` **não** foram tocados (permanecem v1). Código deployado == código na `main`.

## Pré-requisitos (deploy via CLI)

1. CLI autenticada numa conta da **org do Vertexa** (`vpdrdqkqlkcecscwcved`):
   ```bash
   supabase login                 # conta com acesso ao projeto cdhjfyyuhmwrcuxqavib
   # (ou) export SUPABASE_ACCESS_TOKEN=<token da org do Vertexa>
   ```
   Confira com `supabase projects list` — o projeto **Vertexa** (`cdhjfyyuhmwrcuxqavib`) precisa aparecer.
2. Projeto linkado (na raiz `vertexa-web-pro`):
   ```bash
   supabase link --project-ref cdhjfyyuhmwrcuxqavib
   ```
3. `supabase/config.toml` presente (trava o `verify_jwt` por função — já versionado neste repo).

## Deploy (só as duas funções que mudaram)

```bash
cd vertexa-web-pro
supabase functions deploy google-calendar-callback google-calendar-sync --project-ref cdhjfyyuhmwrcuxqavib
```

- O `verify_jwt` vem do `config.toml` (callback=false, sync=true) — **não** passe `--no-verify-jwt`
  manualmente (o config já cobre; ver guardrail acima).
- **Não** use `--prune` (apagaria funções que não estão localmente).

### Verificação pós-deploy

```bash
supabase functions list --project-ref cdhjfyyuhmwrcuxqavib
```
Confirme: `callback` `verify_jwt=false` (versão nova), `sync` `verify_jwt=true` (versão nova); `auth` e
`disconnect` **inalteradas**. Smoke test do callback público (sem `state` → 200 "falha", NÃO 5xx):
```bash
curl -s -i "https://cdhjfyyuhmwrcuxqavib.supabase.co/functions/v1/google-calendar-callback" | head -1
```

## Secrets exigidos pelo código (só NOMES — nunca versionar valores)

Definidos como **Supabase secrets** do projeto (ver `docs/ops/SETUP_GOOGLE_CALENDAR.md §2`):

- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REDIRECT_URI`
- `ALLOWED_REDIRECT_ORIGINS` (opcional; anti open-redirect)

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetados pelo runtime — não precisam ser setados.
Sem os secrets do Google, `auth`/`callback`/`sync` respondem `google_not_configured` (a cifragem em
repouso dos tokens já está 100% funcional; ver PENDENCIAS #22 / WP-A2).
