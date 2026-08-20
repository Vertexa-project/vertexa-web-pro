# Login Google (Supabase Auth) — passo externo — WP-03 / AUTH-01 / WP-04A

O painel web usa **somente** autenticação Supabase/Google. Não há modo demonstração.

`VITE_AUTH_MODE` deixou de escolher comportamento: ausente / vazio / `"real"` sobe o app;
`"demo"` ou qualquer outro valor **falha no boot**. A variável na Vercel pode permanecer
`real` — é inócua; **não altere a Vercel neste WP**.

Para o round-trip funcionar de verdade, um responsável precisa habilitar o provedor Google
**no projeto Supabase** (não vai no bundle; nenhum segredo de servidor no client). Enquanto
não estiver configurado, o clique em "Entrar com Google" chega ao endpoint
`…/auth/v1/authorize?provider=google` e o Supabase responde com erro.

## Passos (uma vez)
1. **Google Cloud Console** → OAuth consent screen + credenciais **OAuth 2.0 Client ID** (Web).
   - Authorized redirect URI: `https://cdhjfyyuhmwrcuxqavib.supabase.co/auth/v1/callback`.
2. **Supabase → Authentication → Providers → Google:** habilitar + colar `Client ID` e `Client Secret`.
3. **Supabase → Authentication → URL Configuration:** adicionar as *Redirect URLs* permitidas
   (ex.: `http://localhost:5173/auth/callback` para dev e a URL de produção `/auth/callback`).
4. No app: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Não defina `VITE_AUTH_MODE=demo`.

## Como funciona a associação (já implementada)
No 1º login, o trigger `handle_new_user` (migration `20260708120000`) associa o `auth.users` a um
`profiles` **por e-mail VERIFICADO** (Google já vem verificado): se houver exatamente 1 profile órfão
com aquele e-mail, vincula; senão cria um profile `status='pending'` → a web mostra **PendingAccess**
(acesso liberado por onboarding/clínica em WP futuro). Ver `docs/CONTRATO_INTEGRACAO.md → Contrato de
identidade`.

## Segurança / pendências
- **Associação só via Google (anti account-takeover).** O trigger só vincula/cria a partir de um
  provedor OAuth confiável (`raw_app_meta_data.provider = 'google'`), **não** apenas de
  `email_confirmed_at`. Motivo: com o setting **Authentication → "Confirm email" OFF**, o Supabase
  auto-confirma signups por e-mail/senha (feitos com a anon key pública) — sem a guarda de provedor, um
  atacante casaria o e-mail de um profissional/admin semeado e sequestraria o profile. **Recomendação
  adicional:** manter "Confirm email" **ON** e, se um dia habilitar login por e-mail/senha, revisar a
  guarda. Hoje só Google associa; e-mail/senha não vincula nem cria pending.
- **RLS ainda permissiva** (sprint): auth real **não** é autorização — fechar por papel/clínica é o
  **WP-05** (`docs/PENDENCIAS.md #11–#14`). Não publicar com dado real antes disso.
- Round-trip Google real = `NÃO_COMPROVADO_AUTOMATICAMENTE` (depende dos secrets acima).
