# Pendências a validar com o cliente (Bruno coleta com Juliana/Gabriel)

> Não bloqueiam o build da sprint, mas precisam ser resolvidas antes de virar definitivo no banco.

1. **Status de recuperação muscular.** O app atual usa `neutral`/`activated`; os combinados das
   calls usam `recovered`/`weakened`. São dois esquemas de 4 cores diferentes. Definir o oficial
   antes de persistir em `muscle_recovery_states`.

2. **Card compartilhável no ecossistema multiprofissional.** Quando há médico + nutri + personal,
   quem aparece no card (para não gerar "injustiça" entre profissionais)? Só o pagante? Os três?

3. **Pesos do VRI v1 e pontuação do ranking.** Confirmar os pesos exatos de cada ação (treino vale
   mais que hábito simples, etc.). Hoje há valores no adherenceEngine.ts — validar com a clínica.

4. **Profissional externo convidado.** Modelo de acesso, permissão e incentivo. Hoje só temos a
   flag `is_external` no link. Falta a regra de negócio.

5. **Foto de treino.** Bloqueia pontuação ou só aumenta confiança? Câmera obrigatória (sem galeria)?

6. **Campanhas MVP vs V2.** Quais entram já e quais ficam para depois.

7. **WhatsApp.** Entra no MVP real ou fica simulado primeiro? (Recomendação: simulado nesta sprint.)

8. **Visão financeira do paciente.** Mostrar paciente com lente financeira (receita/LTV) — o próprio
   cliente levantou possível "conflito moral". Confirmar se entra no perfil do paciente ou só no
   dashboard gerencial.

9. **Relatórios PDF de evolução.** Pedido pela cliente (Discord 14/06) — semana a semana, para ela
   e para o paciente. Coletar como deve funcionar (escopo flexível).

10. **GIFs/vídeos de exercício.** Hoje o app usa URLs de terceiros (fitnessprogramer.com). Definir
    fonte própria/licenciada antes de publicar.

## Pendências técnicas (segurança/infra — antes de dados reais)

11. **RLS real (substituir policy temporária da sprint).** As tabelas estavam com RLS ligada e
    ZERO policies (cliente lia 0 linhas). Adicionada migration `sprint_anon_read_policies` com
    `sprint_read_all` = SELECT `using(true)` para `anon`+`authenticated` em todas as 17 tabelas —
    **TEMPORÁRIA, só com dados fictícios/seed**. Antes de qualquer dado real de paciente: remover
    `anon` do SELECT, trocar por RLS por papel/clínica (admin vê a clínica; profissional vê via
    `professional_patient_links`; externo vê só o paciente vinculado via `is_external`). Não publicar
    em domínio público enquanto estiver `using(true)` (vazamento de dados de saúde — LGPD).

12. **Storage privado + URL assinada.** `progress_photos.photo_url` e `body_assessments.document_url`
    são URLs cruas. Confirmar bucket privado e gerar `createSignedUrl` na camada `api/` antes de
    publicar (já previsto no CLAUDE.md como pós-MVP).

13. **Salvar plano não é transacional.** `saveWorkoutPlan`/`saveNutritionPlan` fazem DELETE do plano
    anterior e depois INSERT do novo (treinos/exercícios/refeições em vários passos). Se falhar no
    meio, o plano antigo já foi apagado e o novo fica parcial. Mover para uma RPC/transação (Postgres
    function `SECURITY DEFINER`) antes de uso real, para o app paciente nunca ler um plano inconsistente.

14. **Checklist de segurança ANTES de dados reais (produção) — BLOQUEANTE.** Hoje a sprint roda com
    RLS permissiva (`using(true)`) + modo demo, só com seed fictício. Antes de qualquer paciente real:
    - **Leitura por papel/clínica** (substituir `sprint_read_all`): admin vê a clínica; profissional vê
      via `professional_patient_links`; externo (`is_external`) só o paciente vinculado. Hoje qualquer
      anon lê tudo (a anon key é pública no bundle).
    - **Escrita de planos restrita** (substituir `sprint_plan_write` `using(true)`): hoje qualquer anon
      pode apagar/reescrever o plano de QUALQUER paciente (o `professionalId` é escolhido no client).
      Validar o vínculo no servidor (RPC `SECURITY DEFINER` + `auth.uid()`), nunca confiar no client.
    - **Escrita do app paciente restrita** (writes permissivos versionados em
      `20260618130000_sprint_write_policies.sql`): `activity_events` (`sprint_activity_write`, INSERT) e
      `muscle_recovery_states` (`sprint_muscle_write_insert` INSERT + `sprint_muscle_write_update` UPDATE)
      hoje aceitam `with check (true)` de qualquer anon — ou seja, qualquer um pode injetar evento/estado
      de recuperação para QUALQUER paciente. Sob RLS real, só o próprio paciente (`auth.uid()` → seu
      `patient_id`) pode escrever os seus eventos/estados. Mesmo padrão em `meal_logs`
      (`20260701120000_meal_logs.sql`: `sprint_meal_write_insert` INSERT + `sprint_meal_write_delete`
      DELETE, `with check`/`using (true)`) e `activity_sessions` (`20260702120000_activity_sessions.sql`:
      `sprint_activity_session_write` INSERT `with check (true)`) — qualquer anon pode marcar/desmarcar
      refeição ou lançar atividade complementar para QUALQUER `patient_id`. Fecham junto na mesma RLS real
      por `auth.uid()` → `patient_id`. Idem `supplements` + `supplement_intakes`
      (`20260702140000_supplements.sql`, S3/app): `sprint_supplement_write` (ALL — autoria futura do web) e
      `sprint_supplement_intake_insert`/`_delete` (`with check`/`using (true)`) — qualquer anon pode editar
      a LISTA de suplementos e marcar/desmarcar "tomado" para QUALQUER `patient_id`. Mesma RLS real fecha.
    - **Modo demo** não pode usar a sessão anon contra o banco real quando a RLS fechar — isolar em
      dataset fictício ou desabilitar em `import.meta.env.PROD`.
    - **IDOR**: `getPatient(id)` lê qualquer UUID da URL; a barreira real é a RLS (acima) — tratar
      0 linhas/erro como 403 na UI.
    - **Storage privado + URL assinada** (ver #12). Confirmar que o app paciente também faz escaping
      do conteúdo de planos/mensagens.
    - **Chat (`chat_channels` / `chat_participants` / `chat_messages` / `chat_mentions`)**: hoje rodam
      permissivas — `sprint_read_all` (SELECT) + `sprint_chat_write` (ALL), `anon`/`authenticated`
      `using(true)`. Sob RLS real, só os **participantes do canal** (paciente dono + profissionais
      vinculados, via `chat_participants`) podem ler/escrever. O **realtime** (`postgres_changes`)
      respeita essas policies — portanto fechar a RLS aqui também controla o que vaza pelo realtime.
    - **Cadastro de paciente pela web (Sessão 4)** — `20260625180000_sprint_patient_create_write_policies.sql`:
      INSERT permissivo em `patients` / `professional_patient_links` / `body_assessments` (`with check (true)`)
      + `profiles` (`with check (role = 'patient')` — já restrito ao papel na sprint para não permitir forjar
      admin/professional). Sob RLS real: derivar `clinic_id`/`professional_id` de `auth.uid()` no servidor
      (RPC `SECURITY DEFINER` que cruza `professionals.profile_id`), nunca confiar no que o client enviou —
      o isolamento por clínica hoje é **client-side** (vem do `DEMO_PROFESSIONAL_PROFILE_ID`).
    - **Ledger técnico interno (Sessão 7/8) — ✅ RESOLVIDO no remoto (S8).** `20260626120000_schema_migration_log.sql`
      criou `schema_migration_log`; `20260626123000_schema_migration_log_internal_only.sql` (**aplicada via MCP em
      2026-06-26**) removeu `miglog_read`, revogou privilégios de `anon`/`authenticated` e manteve RLS ligada.
      Validado: 12 linhas, sem policy pública, `has_table_privilege(anon/authenticated,select)`=false, `relrowsecurity`=true.
      O ledger não aparece no portal (sem API client/hook/rota/card; `rg` em `src`=0); inspeção só por MCP/SQL/migrations.
    - **Agenda interna (Sessão 6)** — `20260626090000_appointments_internal_agenda.sql`:
      `appointments` roda permissiva — `sprint_appointment_read` (SELECT) + `sprint_appointment_write` (ALL),
      `anon`/`authenticated` `using/with check (true)`. Qualquer anon lê/escreve compromissos de QUALQUER
      clínica; o isolamento por `clinic_id` é **client-side** (vem do profissional logado). Sob RLS real:
      admin vê a clínica, profissional vê só a sua, e `clinic_id` deriva de `auth.uid()` no servidor.
      ⚠️ **`appointments.notes` é texto livre vinculado a paciente nominal → DADO SENSÍVEL**: não publicar
      em domínio público enquanto o SELECT for `using(true)`; tratar `notes` como sensível na futura RLS e
      nunca logar. O select de **paciente** no diálogo usa `useListPatients()` (não escopado por clínica,
      igual ao resto do app) — fechar junto (criar `listClinicPatients`).

15. **Aposentar a tabela legada `messages` (web e app já alinhados em `chat_*`).** Tanto a web (Etapa 3)
    quanto o app paciente (TeamChat) leem/escrevem direto em `chat_messages`/`chat_mentions` com realtime
    — o app NUNCA usou a `messages` legada (era 100% mock antes). Logo a `messages` só sobrevive por causa
    do backfill da Etapa 2 e do `supabase/seed.sql` (que ainda insere 2 linhas nela). Pendência (não
    bloqueante): migrar o seed para `chat_*` e dropar `messages` quando ninguém mais depender dela.
    Remetente da web em modo demo = profile fixo da Dra. Camila via `VITE_DEMO_PROFESSIONAL_PROFILE_ID`;
    sob auth real vira `auth.uid()` (ver #14).

16. **`createPatient` não é transacional (Sessão 4).** O cadastro encadeia 4 inserts
    (`profiles` → `patients` → `professional_patient_links` → `body_assessments`) sem transação. Um
    erro no meio deixa um `profile` de paciente (dado pessoal) órfão, sem patient/vínculo e sem caminho
    de UI para limpar (a web não tem DELETE). Igual à dívida #13 dos planos: mover para uma RPC/transação
    (`SECURITY DEFINER`, begin/commit) antes de cadastro real — isso também resolve o isolamento (#14).
    Hoje OK só com seed fictício.

17. **`listPatients` lê embeds sem limite (perf pré-produção).** O `select` da listagem embute
    `activity_events`, `weight_logs(measured_at)` e `progress_photos(taken_at)` SEM limite, só para
    calcular a recência (`lastActivityAt`/`lastWeightAt`/`lastPhotoAt`) no client. Sem impacto com seed,
    mas em produção um paciente com histórico longo traz centenas de linhas por acesso à lista. Mover o
    cálculo para o banco (RPC/`view` com `max()` agrupado) antes de escala real.

18. **Validar esquema de URL de documento no client (Sessão 4 — mitigado).** `DocumentsTab` só abre
    `document_url` num `<a href>` se passar pela allowlist `isSafeDocumentUrl()` (https:// ou
    `data:application/pdf;base64,`) — defesa contra `javascript:`/`data:text/html` gravado por anon
    (INSERT permissivo). A correção definitiva é a #12 (bucket privado + signed URL, sempre https).

19. **Conectar Google Agenda (gancho da Sessão 6 — placeholder).** A agenda é 100% INTERNA nesta fase
    (tabela `appointments`, CRUD na web). O botão "Conectar Google Agenda" no `AgendaCard` é gancho
    desabilitado ("Em breve"). Quando vierem as credenciais: trocar a FONTE da agenda pela API do Google
    (OAuth + escopos), mantendo o CRUD interno como fallback. **Google Meet NÃO entra.** Subdívidas da
    agenda: (a) **RLS/isolamento** de `appointments` por papel/clínica no servidor (parte do #14, incl.
    `notes` sensível); (b) **fuso**: a janela de leitura usa o fuso do NAVEGADOR (`startOfDay` local) e o
    seed ancora em `America/Sao_Paulo` — coincidem no BR (premissa da demo), mas fora do fuso BR a aba
    "Hoje" pode deslocar; robustez real = derivar/persistir o fuso da clínica e calcular a janela nele
    (ex.: `date-fns-tz`); (c) **UX**: confirmação de exclusão usa `window.confirm` nativo (trocar por
    AlertDialog do design system pós-MVP). **Status (Sessão 10): integração REAL read-only implementada**
    (Edge Functions + tabelas `calendar_*` + agenda mesclada interna+Google no `AgendaCard`); o placeholder
    saiu. As subdívidas (a) isolamento server-side → vira **#23**; (b) fuso e (c) `window.confirm` seguem abertas.

20. **Financeiro por papel (Sessão 6 — diferido/stretch).** Não implementado nesta sessão. Forma proposta:
    aba/rota `/financeiro` gated por papel (admin/gestor/financeiro) — com a RBAC mínima por `profiles.role`;
    como a demo loga como Camila (`professional`), a aba ficaria corretamente OCULTA (só admin a veria).
    Conteúdo inicial = placeholder de UI para fontes de import (CSV/PDF/planilha/extrato), **SEM** parser real
    e **SEM** Open Finance. Retomar quando houver persona admin demonstrável ou auth real.

21. **RBAC de UI ≠ RLS de dados (Sessão 7).** O papel do logado (admin/médico/nutri) controla o que a UI
    MOSTRA/EDITA (`lib/domain/roles.ts` + `useRole`), inclusive um seletor de papel "modo demonstração"
    (runtime, não persiste). Isto é **gating de UI, não autorização** — qualquer client com a anon key
    ainda lê/escreve os dados (RLS sprint permissiva). A autorização real por papel/clínica é a dívida
    #11–#14 (Sessão 9): quando a RLS fechar, o papel deve vir de `auth.uid()`→`profiles.role`/`professionals`,
    e o override de demonstração deve ser desabilitado em produção (`import.meta.env.PROD`). O override de
    demo hoje vive só em memória (reseta no reload) — aceitável para a demo (troca de persona ao vivo).

22. **Cifrar `refresh_token` do Google em repouso (Sessão 10 — S9/P1).** A tabela
    `calendar_connection_tokens` é **deny-all** (sem leitura por `anon`/`authenticated`; só `service_role`
    via Edge Function), mas o `refresh_token` é gravado em texto puro. Antes de conectar a agenda REAL de uma
    clínica, cifrar em repouso (pgsodium/Supabase Vault) e descriptografar só na Edge Function. Guarda-chuva
    de segurança da S9 (junto de #11–#14).

23. **Verificação de admin/tenant no SERVIDOR para o Google Calendar (Sessão 10 — S9).** Hoje as Edge
    Functions `google-calendar-auth/sync/disconnect` recebem `clinicId`/`professionalId` do client (não há
    `auth.uid()` no modo demo) e o gating de "admin" é só de UI (RBAC S7). As funções já escopam SEMPRE por
    `clinic_id` (sem caminho por id solto — corrigido na revisão da S10), mas a posse real ("admin desta
    clínica") só fecha na S9: a função deve ler o JWT → `auth.uid()` → `profiles`/`professionals` e rejeitar
    divergência de clínica. **Pré-S9: conectar apenas conta Google de TESTE** (ver `docs/ops/SETUP_GOOGLE_CALENDAR.md`).
    Hardening já aplicado: `ALLOWED_REDIRECT_ORIGINS` (allowlist do redirect do callback) — configurar em produção.

24. **Seleção da conexão da clínica por status (Sessão 10 — latente, pós-S9).** `getCalendarConnection` e o
    `google-calendar-sync` (escopo por clínica) pegam a conexão mais recente por `updated_at` (limit 1), sem
    priorizar `status='connected'`. Com **mais de uma conexão por clínica** (só possível com OAuth real e 2+
    contas, post-S9), uma conexão `revoked`/`error` recém-falhada (que bumpa `updated_at`) poderia ser
    re-selecionada no lugar de uma boa. Hoje há no máximo 1 conexão por clínica (seed/demo), então não se
    manifesta. Correção: priorizar `connected` (ou alinhar com a decisão de unicidade do índice) ao resolver
    "a conexão da clínica".

25. **Fuso horário fixo no calendário (Sessão 12 — pós-demo).** O FullCalendar usa `timeZone: 'local'` (correto
    para a demo BR — fuso do navegador). Para clínicas/usuários fora de `America/Sao_Paulo` (ex.: Manaus, Acre),
    a linha do "agora" e a posição dos eventos divergem do horário da clínica. Pós-demo, fixar
    `timeZone: 'America/Sao_Paulo'` exige o plugin `@fullcalendar/luxon3` (~60 KB gzip) — não entrou agora para
    não inflar o bundle. Avaliar quando houver clínica multi-fuso. **Obs.:** a RLS real dos novos campos
    `appointments.type/status` segue no guarda-chuva da S9 (a policy de sprint de `appointments` é permissiva;
    ver #11–#14) — adicionar colunas não muda o modelo de acesso.
