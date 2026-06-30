# Setup — Integração Google Calendar (Sessão 10)

Read-only, multi-tenant, via **Supabase Edge Functions (Deno)**. O client Vite **nunca** vê
`client_secret` nem `refresh_token`. Este runbook é o roteiro manual de configuração + teste.

> ⚠️ **Guardrail (LGPD / pré-S9):** use **apenas uma conta Google de TESTE com eventos fictícios**.
> Títulos de evento podem conter nome de paciente (dado de saúde) e os tokens são sensíveis; a RLS real
> por clínica só fecha na **S9**. **Não conecte a agenda real de uma clínica antes da S9.**

## Arquitetura (o que já está no repo/Supabase)

- **Migrations:** `20260626140000_calendar_integration.sql` (4 tabelas + RLS) e
  `20260626150000_seed_demo_calendar.sql` (seed fictício). Já aplicadas no projeto `cdhjfyyuhmwrcuxqavib`.
- **Tabelas:** `calendar_connections` (metadado, leitura sprint), `calendar_connection_tokens`
  (**DENY-ALL** — só `service_role`), `calendar_event_cache` (leitura sprint), `calendar_oauth_state`
  (**DENY-ALL** — anti-CSRF, TTL 10 min, single-use).
- **Edge Functions (deployadas):** `google-calendar-auth` (init), `google-calendar-callback`
  (`verify_jwt=false`), `google-calendar-sync`, `google-calendar-disconnect`.
- **Front:** `Configurações → Integrações → Google Calendar` (status + Conectar/Atualizar/Desconectar,
  **admin-gated**) e rodapé do `AgendaCard` (status + Conectar/Atualizar). A agenda do Dashboard mescla
  compromissos internos (S6) + eventos do Google (read-only, com chip "Google").

## URLs do callback (registrar no Google Cloud Console)

```
CALLBACK_LOCAL     = http://localhost:54321/functions/v1/google-calendar-callback
CALLBACK_PRODUCAO  = https://cdhjfyyuhmwrcuxqavib.supabase.co/functions/v1/google-calendar-callback
```

O `redirect_uri` registrado no Google é a **Edge Function** (não o `localhost:5173`/Vercel). Após a
troca, a function faz `302` de volta ao SPA em `<origem>/configuracoes?calendar=connected|error`
(a origem vem de `window.location.origin`, enviada no init).

## 1. Google Cloud Console

1. Crie/abra um projeto. **APIs & Services → Library → Google Calendar API → Enable.**
2. **OAuth consent screen:** tipo *External*; adicione os escopos **read-only**:
   - `.../auth/calendar.events.readonly`
   - `.../auth/calendar.calendarlist.readonly`
   - Em *Test users*, adicione a conta Google de **TESTE** (enquanto o consent estiver em "Testing").
3. **Credentials → Create credentials → OAuth client ID → Web application.**
   - **Authorized redirect URIs:** cole `CALLBACK_LOCAL` e `CALLBACK_PRODUCAO` (acima).
   - Guarde o **Client ID** e o **Client secret**.

## 2. Supabase Secrets (NUNCA no client Vite, NUNCA `NEXT_PUBLIC_`)

```bash
supabase secrets set \
  GOOGLE_CALENDAR_CLIENT_ID="<client id>" \
  GOOGLE_CALENDAR_CLIENT_SECRET="<client secret>" \
  GOOGLE_CALENDAR_REDIRECT_URI="https://cdhjfyyuhmwrcuxqavib.supabase.co/functions/v1/google-calendar-callback"
```

> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já são injetados pelo runtime das Edge Functions — não
> precisam ser setados. Para testar localmente (`supabase functions serve`), use o `REDIRECT_URI` local.

**Hardening recomendado (anti open-redirect):** defina `ALLOWED_REDIRECT_ORIGINS` com as origens do SPA
permitidas (separadas por vírgula). Quando setado, o callback só redireciona o navegador de volta para
essas origens; sem ele, vale o filtro de protocolo (fallback de dev).

```bash
supabase secrets set ALLOWED_REDIRECT_ORIGINS="http://localhost:5173,https://vertexa-web-pro-lspa.vercel.app"
```

## 3. Roteiro de teste manual (conta de TESTE)

1. Numa agenda Google de teste, crie 2–3 **eventos fictícios** (sem nome real de paciente).
2. No portal (modo demonstração), troque o papel para **Admin** (menu de conta → Papel).
3. **Configurações → Integrações → Google Calendar → Conectar Google Agenda** → consentir no Google.
4. Volta para `…/configuracoes?calendar=connected` (badge "Conectado com sucesso").
5. **Atualizar agenda** → os eventos aparecem no **Dashboard → Agenda** com o chip **"Google"**,
   mesclados aos compromissos internos, **somente leitura** (sem editar/excluir).
6. **Desconectar** → revoga no Google (best-effort) e remove conexão + tokens + cache.

## Estado de verificação

- **Migrations + RLS + Edge Functions deployadas + UI + seed:** comprovados nesta sessão (MCP + build + Playwright).
- **Round-trip OAuth real (passos 3–6):** `NÃO_COMPROVADO_AUTOMATICAMENTE` — depende das credenciais do
  Google configuradas pelo responsável (passos 1–2). Sem os secrets, `Conectar` responde
  `google_not_configured` (aviso amigável), e a demo usa o **seed** para exibir a agenda mesclada.

## Dívidas (ver docs/PENDENCIAS.md)

- **#22** — cifrar `refresh_token` em repouso (pgsodium/Vault) — **S9/P1**.
- **#23** — verificação de admin/tenant **no servidor** via `auth.uid()` (hoje a identidade
  clinic/professional vem do client; isolamento real por clínica é a **S9** / #11–#14).
