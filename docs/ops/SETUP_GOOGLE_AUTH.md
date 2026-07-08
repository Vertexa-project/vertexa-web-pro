# Login Google (Supabase Auth) — passo externo — WP-03 / AUTH-01

O código do login Google já existe (`VITE_AUTH_MODE=real`). Para o round-trip funcionar de
verdade, um responsável precisa habilitar o provedor Google **no projeto Supabase** (não vai no
bundle; nenhum segredo de servidor no client). Enquanto não estiver configurado, o clique em
"Entrar com Google" chega ao endpoint `…/auth/v1/authorize?provider=google` e o Supabase responde
com erro (a demo continua usando `VITE_AUTH_MODE=demo`).

## Passos (uma vez)
1. **Google Cloud Console** → OAuth consent screen + credenciais **OAuth 2.0 Client ID** (Web).
   - Authorized redirect URI: `https://cdhjfyyuhmwrcuxqavib.supabase.co/auth/v1/callback`.
2. **Supabase → Authentication → Providers → Google:** habilitar + colar `Client ID` e `Client Secret`.
3. **Supabase → Authentication → URL Configuration:** adicionar as *Redirect URLs* permitidas
   (ex.: `http://localhost:5173/auth/callback` para dev e a URL de produção `/auth/callback`).
4. No app: `VITE_AUTH_MODE=real` (e manter `VITE_SUPABASE_URL`/`ANON_KEY`).

## Como funciona a associação (já implementada)
No 1º login, o trigger `handle_new_user` (migration `20260708120000`) associa o `auth.users` a um
`profiles` **por e-mail VERIFICADO** (Google já vem verificado): se houver exatamente 1 profile órfão
com aquele e-mail, vincula; senão cria um profile `status='pending'` → a web mostra **PendingAccess**
(acesso liberado por onboarding/clínica em WP futuro). Ver `docs/CONTRATO_INTEGRACAO.md → Contrato de
identidade`.

## Segurança / pendências
- **RLS ainda permissiva** (sprint): auth real **não** é autorização — fechar por papel/clínica é o
  **WP-05** (`docs/PENDENCIAS.md #11–#14`). Não publicar com dado real antes disso.
- **PROD** deve rodar `VITE_AUTH_MODE=real` (pin/demo ficam inertes); gate por `import.meta.env.PROD` é
  dívida anotada (#21).
- Round-trip Google real = `NÃO_COMPROVADO_AUTOMATICAMENTE` (depende dos secrets acima).
